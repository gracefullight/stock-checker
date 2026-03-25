import type { ConfluenceConfig, ConfluenceResult } from '@/types';

const CONFLUENCE_INDICATORS = [
  'rsi',
  'stochK',
  'bollingerPctB',
  'donchianPosition',
  'williamsR',
  'macd',
] as const;

export function confluenceCheck(params: {
  gradients: Record<string, number>;
  config: ConfluenceConfig;
}): ConfluenceResult {
  const { gradients, config } = params;

  let activeIndicators = 0;
  for (const key of CONFLUENCE_INDICATORS) {
    if ((gradients[key] ?? 0) >= config.activationThreshold) {
      activeIndicators++;
    }
  }

  const totalIndicators = CONFLUENCE_INDICATORS.length;
  const ratio = activeIndicators / totalIndicators;
  const passed = activeIndicators >= config.minActive;

  return { passed, activeIndicators, totalIndicators, ratio };
}
