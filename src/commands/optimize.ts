import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import { Optimizer } from '@/optimization/optimizer';

const logger = pino({
  level: 'info',
  transport: { target: 'pino-pretty' },
});

export async function optimize(symbol: string, options: { trials: string }) {
  const trials = parseInt(options.trials, 10);
  const targetSymbol = symbol || 'TSLA';

  logger.info(`Running optimization for ${targetSymbol} with ${trials} trials...`);

  const optimizer = new Optimizer();

  try {
    const result = await optimizer.optimize(targetSymbol, trials);

    // Save to JSON
    const outputDir = path.join(process.cwd(), 'data/config');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(
      path.join(outputDir, `optimization_${targetSymbol}_${timestamp}.json`),
      JSON.stringify(result, null, 2)
    );

    // Also save 'latest'
    fs.writeFileSync(
      path.join(outputDir, 'optimized_weights.json'),
      JSON.stringify(result, null, 2)
    );

    logger.info('Optimization complete.');
    logger.info(`Best Value: ${result.bestValue.toFixed(4)}`);
    // logger.info('Best Parameters:', JSON.stringify(result.bestParams, null, 2));

    logger.info('Updating constants.ts...');

    // Read constants.ts
    const constantsPath = path.join(process.cwd(), 'src/constants.ts');
    if (fs.existsSync(constantsPath)) {
      let content = fs.readFileSync(constantsPath, 'utf-8');

      // Regex replace for weights
      const w = result.bestParams.indicatorWeights;
      const t = result.bestParams.thresholds;

      const replaceVal = (key: string, val: number) => {
        const regex = new RegExp(`${key}: \\d+`, 'g');
        content = content.replace(regex, `${key}: ${Math.round(val)}`);
      };

      replaceVal('rsi', w.rsi);
      replaceVal('stochastic', w.stochastic);
      replaceVal('bollinger', w.bollinger);
      replaceVal('donchian', w.donchian);
      replaceVal('williamsR', w.williamsR);
      replaceVal('fearGreed', w.fearGreed);
      replaceVal('macd', w.macd);
      replaceVal('sma', w.sma);
      replaceVal('ema', w.ema);

      // Thresholds
      content = content.replace(
        /export const BUY_THRESHOLD = \d+;/,
        `export const BUY_THRESHOLD = ${Math.round(t.buy)};`
      );
      content = content.replace(
        /export const SELL_THRESHOLD = \d+;/,
        `export const SELL_THRESHOLD = ${Math.round(t.sell)};`
      );

      fs.writeFileSync(constantsPath, content);
      logger.info('Successfully updated src/constants.ts');
    } else {
      logger.warn('src/constants.ts not found, skipping update.');
    }
  } catch (error) {
    logger.error({ err: error }, 'Optimization failed');
    process.exit(1);
  }
}
