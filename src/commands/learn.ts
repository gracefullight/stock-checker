import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DateTime } from 'luxon';
import pino from 'pino';
import { fitPlattScaling } from '@/optimization/calibrator';
import { calculateMetrics, matchPredictions, type PredictionInput } from '@/optimization/evaluator';
import { Optimizer } from '@/optimization/optimizer';
import { p, pc } from '@/ui/prompts';

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
    p.intro(pc.bgCyan(pc.black(' stock-checker learn ')));

    // 1. Run Predictions
    const s1 = p.spinner();
    s1.start('Running predictions...');
    await runCommand('bun', [
      'src/index.ts',
      'predict',
      '--ticker=TSLA,PLTR,AAPL,MSFT,GOOGL,NVDA,AMD,INTC,AMD',
      '--sort=asc',
    ]);
    s1.stop('Predictions complete');

    // 2. Match Predictions
    const s2 = p.spinner();
    s2.start('Matching predictions with historical data...');

    if (!fs.existsSync(FEEDBACK_DIR)) {
      s2.stop(pc.red('No feedback directory found'));
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
        const rowTicker = parts[tickerIdx];

        if (!rowTicker) continue;

        if (!priceHistory.has(rowTicker)) priceHistory.set(rowTicker, new Map());
        priceHistory.get(rowTicker)?.set(date, close);
      }
    }

    const matched = matchPredictions(allPredictions, priceHistory);
    s2.stop(`Matched ${pc.bold(String(matched.length))} predictions`);

    // 3. Evaluate
    const s3 = p.spinner();
    s3.start('Evaluating accuracy...');
    const metrics = calculateMetrics(matched);
    logger.info({ metrics }, 'Metrics Calculated');

    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    const metricsPath = path.join(CONFIG_DIR, 'accuracy_metrics.json');
    fs.writeFileSync(metricsPath, JSON.stringify(metrics, null, 2));
    s3.stop(`Hit rate: ${pc.bold(`${metrics.hitRate.toFixed(1)}%`)}`);

    // 4. Calibrate
    const s4 = p.spinner();
    s4.start('Calibrating probabilities...');
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
    s4.stop('Calibration complete');

    // 5. Optimize
    const s5 = p.spinner();
    s5.start('Optimizing hyperparameters...');
    const optimizer = new Optimizer();
    const optimizationTickers = ['TSLA', 'GOOGL', 'AAPL'];
    let bestOverallResult = null;
    let bestOverallValue = -Infinity;

    for (const sym of optimizationTickers) {
      try {
        s5.message(`Optimizing ${pc.bold(sym)}...`);
        const result = await optimizer.optimize(sym, 200);
        logger.info({ symbol: sym, value: result.bestValue }, 'Optimization result');
        if (result.bestValue > bestOverallValue) {
          bestOverallValue = result.bestValue;
          bestOverallResult = result;
        }
      } catch (err) {
        logger.warn({ symbol: sym, err }, 'Optimization failed for symbol, skipping');
      }
    }

    if (!bestOverallResult) {
      s5.stop(pc.red('All optimizations failed'));
      throw new Error('All optimizations failed');
    }

    const optResult = bestOverallResult;
    const timestamp = DateTime.now().toFormat('yyyyMMdd_HHmmss');
    fs.writeFileSync(
      path.join(CONFIG_DIR, `optimization_${optResult.symbol}_${timestamp}.json`),
      JSON.stringify(optResult, null, 2)
    );

    const { saveOptimizedConfig } = await import('@/utils/config-loader');
    await saveOptimizedConfig({
      weights: optResult.bestParams.indicatorWeights,
      thresholds: optResult.bestParams.thresholds,
      patternWeights: optResult.bestParams.patternWeights,
      calibration: optResult.bestParams.calibration,
    });

    s5.stop(`Best: ${pc.bold(optResult.symbol)} (${pc.green(bestOverallValue.toFixed(4))})`);

    p.outro(pc.green('Learning loop complete!'));
  } catch (e) {
    logger.error({ err: e }, 'Learning loop failed');
    process.exit(1);
  }
}
