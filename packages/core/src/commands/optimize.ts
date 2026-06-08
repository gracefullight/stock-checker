import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
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
    if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    writeFileSync(
      path.join(outputDir, `optimization_${targetSymbol}_${timestamp}.json`),
      JSON.stringify(result, null, 2)
    );

    logger.info('Optimization complete.');
    logger.info(`Best Value: ${result.bestValue.toFixed(4)}`);
    // logger.info('Best Parameters:', JSON.stringify(result.bestParams, null, 2));

    // Save as optimized config JSON (loaded at runtime by config-loader)
    const { saveOptimizedConfig } = await import('@/utils/config-loader');
    await saveOptimizedConfig({
      weights: result.bestParams.indicatorWeights,
      thresholds: result.bestParams.thresholds,
      patternWeights: result.bestParams.patternWeights,
      calibration: result.bestParams.calibration,
    });
    logger.info('Optimized config saved to data/config/optimized_weights.json');
  } catch (error) {
    logger.error({ err: error }, 'Optimization failed');
    process.exit(1);
  }
}
