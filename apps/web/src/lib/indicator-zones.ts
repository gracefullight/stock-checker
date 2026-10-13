/**
 * One meaning for indicator colours across the screener, the detail table and
 * the gauges: an oscillator extreme is a caution (amber) with a text label.
 * Green and red stay reserved for the engine's final decision and price change.
 */
export type IndicatorZone = 'overbought' | 'oversold' | 'neutral';

export interface ZoneBounds {
  /** Values at or below this are oversold. */
  oversold?: number;
  /** Values at or above this are overbought. */
  overbought?: number;
}

export const INDICATOR_ZONES = {
  rsi: { oversold: 30, overbought: 70 },
  stochK: { oversold: 20, overbought: 80 },
  williamsR: { oversold: -80, overbought: -20 },
} as const satisfies Record<string, ZoneBounds>;

export const ZONE_LABEL: Record<IndicatorZone, string> = {
  overbought: 'OVERBOUGHT',
  oversold: 'OVERSOLD',
  neutral: 'NEUTRAL',
};

export const ZONE_SHORT_LABEL: Record<IndicatorZone, string> = {
  overbought: 'OB',
  oversold: 'OS',
  neutral: '',
};

export function indicatorZone(value: number, bounds: ZoneBounds): IndicatorZone {
  if (!Number.isFinite(value)) return 'neutral';
  if (bounds.oversold !== undefined && value <= bounds.oversold) return 'oversold';
  if (bounds.overbought !== undefined && value >= bounds.overbought) return 'overbought';
  return 'neutral';
}

/** Text colour class: extremes are amber cautions, never buy/sell green or red. */
export function zoneTextClass(zone: IndicatorZone): string {
  return zone === 'neutral' ? 'text-foreground' : 'text-warning';
}

/** CSS token used by canvas/SVG charts for the same zone meaning. */
export function zoneTokenVar(zone: IndicatorZone): string {
  return zone === 'neutral' ? 'var(--muted-foreground)' : 'var(--warning)';
}
