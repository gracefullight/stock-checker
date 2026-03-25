import type { TrendGateConfig, TrendGateResult } from '@/types';

export function trendGate(params: {
  close: number;
  sma50: number;
  sma200: number;
  config: TrendGateConfig;
}): TrendGateResult {
  const { close, sma50, sma200, config } = params;

  if (!config.enabled) {
    return { passed: true, regime: 'unknown', strength: 0, reason: 'trend gate disabled' };
  }

  if (Number.isNaN(sma200) || Number.isNaN(sma50)) {
    return { passed: true, regime: 'unknown', strength: 0, reason: 'insufficient data for SMA' };
  }

  const conditions = [close > sma200, sma50 > sma200, close > sma50];
  const conditionsMet = conditions.filter(Boolean).length;

  // Sideways detection: SMA50/200 difference < threshold%
  const smaDiffPct = (Math.abs(sma50 - sma200) / sma200) * 100;
  const isBetween =
    (close >= Math.min(sma50, sma200) && close <= Math.max(sma50, sma200));
  const isSideways = smaDiffPct < config.sidewaysThreshold && isBetween;

  const effectiveMinConditions = isSideways
    ? Math.max(1, config.minConditions - 1)
    : config.minConditions;

  const passed = conditionsMet >= effectiveMinConditions;
  const strength = (conditionsMet / 3) * 100;

  let regime: TrendGateResult['regime'];
  if (conditionsMet === 3) {
    regime = 'uptrend';
  } else if (conditionsMet === 0) {
    regime = 'downtrend';
  } else if (isSideways) {
    regime = 'sideways';
  } else if (conditionsMet >= 2) {
    regime = 'uptrend';
  } else {
    regime = 'downtrend';
  }

  const reason = `${conditionsMet}/3 conditions met${isSideways ? ' (sideways relaxed)' : ''}`;

  return { passed, regime, strength, reason };
}
