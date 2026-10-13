import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SIGNAL_THRESHOLDS,
  deriveSignalVisual,
  signalThresholdsFromConfig,
} from '@/lib/signal-visuals';

describe('deriveSignalVisual', () => {
  it('uses the shipped leader-pullback thresholds by default', () => {
    expect(DEFAULT_SIGNAL_THRESHOLDS).toEqual({ buy: 200, sell: 130, scoreMax: 400 });
  });

  it('marks a high-scoring HOLD as blocked instead of a strong buy', () => {
    const visual = deriveSignalVisual({ decision: 'HOLD', score: 320 });
    expect(visual.state).toBe('blocked');
    expect(visual.label).toBe('BLOCKED');
    expect(visual.tone).toBe('warning');
    expect(visual.scoreQualified).toBe(true);
    expect(visual.description).toContain('차단');
  });

  it('names overextension when the score reaches the config cap', () => {
    const visual = deriveSignalVisual({ decision: 'HOLD', score: 420 });
    expect(visual.state).toBe('blocked');
    expect(visual.overCap).toBe(true);
    expect(visual.pct).toBe(100);
    expect(visual.description).toContain('상한 400');
  });

  it('keeps BUY and SELL tied to the final decision, not the raw score', () => {
    expect(deriveSignalVisual({ decision: 'BUY', score: 250 })).toMatchObject({
      state: 'buy',
      tone: 'success',
      label: 'BUY',
      meterMax: 400,
      pct: 62.5,
    });
    expect(deriveSignalVisual({ decision: 'SELL', score: 50 })).toMatchObject({
      state: 'sell',
      tone: 'destructive',
      label: 'SELL',
    });
  });

  it('treats a low-scoring HOLD as a plain hold', () => {
    const visual = deriveSignalVisual({ decision: 'HOLD', score: 120 });
    expect(visual).toMatchObject({ state: 'hold', tone: 'muted', label: 'HOLD', pct: 30 });
    expect(visual.description).toContain('진입 없음');
  });

  it('prefers the separate buy score and the frozen config thresholds when provided', () => {
    const thresholds = signalThresholdsFromConfig({
      thresholds: { buy: 150, sell: 90 },
      qualityGate: {
        enabled: true,
        ibsMax: 0.2,
        atrPctMax: 3.5,
        volRMin: 0.8,
        volRMax: 99,
        scoreMax: 300,
      },
    });
    expect(thresholds).toEqual({ buy: 150, sell: 90, scoreMax: 300 });
    const visual = deriveSignalVisual({ decision: 'HOLD', score: 40, buyScore: 160, thresholds });
    expect(visual.state).toBe('blocked');
    expect(visual.meterMax).toBe(300);
  });

  it('falls back to defaults when a legacy job has no frozen config', () => {
    expect(signalThresholdsFromConfig(undefined)).toBe(DEFAULT_SIGNAL_THRESHOLDS);
  });
});
