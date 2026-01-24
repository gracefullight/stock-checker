import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DateTime } from 'luxon';
import pino from 'pino';
import { fitPlattScaling } from '@/optimization/calibrator';
import { calculateMetrics, matchPredictions, type PredictionInput } from '@/optimization/evaluator';
import { Optimizer } from '@/optimization/optimizer';

const logger = pino({
  level: 'info',
  transport: { target: 'pino-pretty' },
});

// Config
const PROJECT_ROOT = process.cwd();
const FEEDBACK_DIR = path.join(PROJECT_ROOT, 'data/feedback');
const CONFIG_DIR = path.join(PROJECT_ROOT, 'data/config');
const CSV_DIR = path.join(PROJECT_ROOT, 'public');

async function runCommand(cmd: string, args: string[]) {
  logger.info(`> ${cmd} ${args.join(' ')}`);
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: 'inherit', cwd: PROJECT_ROOT });
    proc.on('close', (code) => {
      if (code === 0) resolve(code);
      else reject(new Error(`Command failed with code ${code}`));
    });
  });
}

export async function learn() {
  try {
    logger.info('=== Stock Prediction Learning Loop (TypeScript Port) ===');

    // 1. Run Predictions
    logger.info('Step 1: Run TypeScript predictions...');
    // We assume the main CLI entry point supports 'predict' command
    // or we can call the 'start' script if it is updated to point to the right place.
    // For safety, let's call the script directly via bun to ensure we use the new structure.
    await runCommand('bun', [
      'src/index.ts',
      'predict',
      '--ticker=TSLA,PLTR,AAPL,MSFT,GOOGL,NVDA,AMD,INTC,AMD',
      '--sort=asc',
    ]);

    // 2. Match Predictions
    logger.info('Step 2: Match predictions with historical data...');
    // Load All Predictions
    if (!fs.existsSync(FEEDBACK_DIR)) {
      logger.error('No feedback directory found.');
      process.exit(1);
    }

    const files = fs
      .readdirSync(FEEDBACK_DIR)
      .filter((f) => f.startsWith('predictions_') && f.endsWith('.json'));
    const allPredictions: PredictionInput[] = [];

    for (const file of files) {
      const content = fs.readFileSync(path.join(FEEDBACK_DIR, file), 'utf-8');
      try {
        const json = JSON.parse(content);
        if (Array.isArray(json)) {
          allPredictions.push(
            ...json.map((r) => ({
              Date: r.date,
              Ticker: r.ticker,
              Result: r.opinion,
              Opinion: r.opinion,
              Close: r.close.toString(),
              Score: r.score,
            }))
          );
        }
      } catch (e) {
        logger.warn({ file, err: e }, 'Failed to parse file');
      }
    }

    // Load Price Data
    const csvFiles = fs
      .readdirSync(CSV_DIR)
      .filter((f) => f.startsWith('stock_data_') && f.endsWith('.csv'));
    const priceHistory = new Map<string, Map<string, number>>();

    for (const file of csvFiles) {
      const content = fs.readFileSync(path.join(CSV_DIR, file), 'utf-8');
      const lines = content.split('\n');
      const header = lines[0].split(',');
      const dateIdx = header.indexOf('Date');
      const tickerIdx = header.indexOf('Ticker');
      const closeIdx = header.indexOf('Close');

      if (dateIdx === -1 || closeIdx === -1) continue;

      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',');
        if (parts.length < header.length) continue;
        const date = parts[dateIdx];
        const close = parseFloat(parts[closeIdx]);
        const rowTicker = parts[tickerIdx]; // Assuming Ticker is in CSV

        if (!rowTicker) continue;

        if (!priceHistory.has(rowTicker)) priceHistory.set(rowTicker, new Map());
        priceHistory.get(rowTicker)?.set(date, close);
      }
    }

    const matched = matchPredictions(allPredictions, priceHistory);
    logger.info(`Matched ${matched.length} predictions.`);

    // 3. Evaluate
    logger.info('Step 3: Evaluate accuracy...');
    const metrics = calculateMetrics(matched);
    logger.info({ metrics }, 'Metrics Calculated');

    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    const metricsPath = path.join(CONFIG_DIR, 'accuracy_metrics.json');
    fs.writeFileSync(metricsPath, JSON.stringify(metrics, null, 2));

    // 4. Calibrate
    logger.info('Step 4: Calibrate probabilities...');
    const calibrationData = matched
      .map((m) => ({
        score: m.Score,
        isCorrect: m.isCorrect,
      }))
      .filter((d): d is { score: number; isCorrect: boolean } => typeof d.score === 'number');

    const calibrationResult = fitPlattScaling(
      calibrationData.map((d) => d.score),
      calibrationData.map((d) => d.isCorrect)
    );

    logger.info({ calibrationResult }, 'Calibration Result');
    fs.writeFileSync(
      path.join(CONFIG_DIR, 'calibration_params.json'),
      JSON.stringify(calibrationResult, null, 2)
    );

    // 5. Optimize
    logger.info('Step 5: Optimize hyperparameters...');
    const optimizer = new Optimizer();
    // Optimize for TSLA as valid proxy
    const optResult = await optimizer.optimize('TSLA', 50); // 50 trials

    // Save
    const timestamp = DateTime.now().toFormat('yyyyMMdd_HHmmss');
    fs.writeFileSync(
      path.join(CONFIG_DIR, `optimization_TSLA_${timestamp}.json`),
      JSON.stringify(optResult, null, 2)
    );

    fs.writeFileSync(
      path.join(CONFIG_DIR, 'optimized_weights.json'),
      JSON.stringify(optResult, null, 2)
    );

    logger.info('Update constants.ts...');
    const constantsPath = path.join(PROJECT_ROOT, 'src/constants.ts');
    if (fs.existsSync(constantsPath)) {
      let content = fs.readFileSync(constantsPath, 'utf-8');
      const w = optResult.bestParams.indicatorWeights;
      const t = optResult.bestParams.thresholds;

      const replaceVal = (key: string, val: number) => {
        const regex = new RegExp(`${key}: \\d+`, 'g');
        content = content.replace(regex, `${key}: ${Math.round(val)}`);
      };

      for (const [k, v] of Object.entries(w)) {
        replaceVal(k, v as number);
      }

      content = content.replace(
        /export const BUY_THRESHOLD = \d+;/,
        `export const BUY_THRESHOLD = ${Math.round(t.buy)};`
      );
      content = content.replace(
        /export const SELL_THRESHOLD = \d+;/,
        `export const SELL_THRESHOLD = ${Math.round(t.sell)};`
      );

      fs.writeFileSync(constantsPath, content);
    }

    logger.info('=== Learning Loop Complete ===');
  } catch (e) {
    logger.error({ err: e }, 'Learning loop failed');
    process.exit(1);
  }
}
