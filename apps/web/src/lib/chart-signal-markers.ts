import type { SignalFingerprint } from '@/lib/signal-gates.types';

export interface SignalCandleLike {
  time: string;
  signal: 'BUY' | 'SELL' | 'HOLD' | null;
  /** Strategy id stamped on the CSV row the marker came from (post-merge). */
  signalStrategyId?: string | null;
  /** Config SHA-256 stamped on the CSV row (post-merge). */
  signalConfigSha256?: string | null;
  /** Server-side verdict when the API already filtered legacy rows (post-merge). */
  signalLegacy?: boolean | null;
}

export interface SignalMarker {
  time: string;
  signal: 'BUY' | 'SELL';
  /** True when the row cannot be verified against the current configuration. */
  legacy: boolean;
}

function verified(candle: SignalCandleLike, current: SignalFingerprint | undefined): boolean {
  if (!current) return false;
  const shaKnown = !!current.configSha256 && !!candle.signalConfigSha256;
  const idKnown = !!current.strategyId && !!candle.signalStrategyId;
  if (!shaKnown && !idKnown) return false;
  if (shaKnown && candle.signalConfigSha256 !== current.configSha256) return false;
  if (idKnown && candle.signalStrategyId !== current.strategyId) return false;
  return true;
}

/**
 * Chart BUY/SELL markers are drawn from monthly prediction CSVs that mix
 * strategy versions. A marker is "current" only when its row carries a
 * fingerprint that matches the active configuration (or the API says so);
 * everything else is drawn as a legacy marker so it cannot be read as the
 * live strategy's track record.
 */
export function classifySignalMarkers(
  candles: SignalCandleLike[],
  current?: SignalFingerprint
): SignalMarker[] {
  const markers: SignalMarker[] = [];
  for (const candle of candles) {
    if (candle.signal !== 'BUY' && candle.signal !== 'SELL') continue;
    const legacy =
      typeof candle.signalLegacy === 'boolean' ? candle.signalLegacy : !verified(candle, current);
    markers.push({ time: candle.time, signal: candle.signal, legacy });
  }
  return markers;
}

export function markerSummary(markers: SignalMarker[]): {
  current: number;
  legacy: number;
} {
  let current = 0;
  let legacy = 0;
  for (const marker of markers) {
    if (marker.legacy) legacy += 1;
    else current += 1;
  }
  return { current, legacy };
}
