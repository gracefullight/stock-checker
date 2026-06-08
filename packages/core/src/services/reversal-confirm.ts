import type { CandleData, ReversalConfig, ReversalConfirmation } from '@/types';

export function reversalConfirm(params: {
  recentCandles: CandleData[];
  volumeRatio: number;
  config: ReversalConfig;
}): ReversalConfirmation {
  const { recentCandles, volumeRatio, config } = params;

  if (!config.enabled) {
    return { status: 'confirmed', trigger: null };
  }

  // Need at least 2 candles (day[-1] for confirmation, day[0] for current)
  if (recentCandles.length < 2) {
    return { status: 'confirmed', trigger: null };
  }

  // Check confirmation candle (second-to-last = day[-1])
  const confirmCandle = recentCandles[recentCandles.length - 2];
  const bullishCandle = confirmCandle.close > confirmCandle.open;
  const volumeSpike = volumeRatio >= config.volumeMultiplier;

  if (!bullishCandle) {
    return { status: 'rejected', trigger: null };
  }

  const trigger = bullishCandle && volumeSpike ? 'both' : 'bullish_candle';
  return { status: 'confirmed', trigger };
}
