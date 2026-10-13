import { describe, expect, it } from 'vitest';
import { classifySignalMarkers, markerSummary } from '@/lib/chart-signal-markers';

const current = { strategyId: 'leader-pullback-v1', configSha256: 'abc' };

describe('classifySignalMarkers', () => {
  it('treats unstamped CSV rows as legacy because they cannot be verified', () => {
    const markers = classifySignalMarkers([
      { time: '2026-09-30', signal: 'BUY' },
      { time: '2026-10-01', signal: 'HOLD' },
      { time: '2026-10-02', signal: 'SELL' },
    ]);
    expect(markers).toEqual([
      { time: '2026-09-30', signal: 'BUY', legacy: true },
      { time: '2026-10-02', signal: 'SELL', legacy: true },
    ]);
  });

  it('marks rows current only when the fingerprint matches the active config', () => {
    const markers = classifySignalMarkers(
      [
        {
          time: '1',
          signal: 'BUY',
          signalStrategyId: 'leader-pullback-v1',
          signalConfigSha256: 'abc',
        },
        {
          time: '2',
          signal: 'BUY',
          signalStrategyId: 'leader-pullback-v1',
          signalConfigSha256: 'old',
        },
        { time: '3', signal: 'BUY', signalStrategyId: 'momentum-v2' },
        { time: '4', signal: 'BUY', signalConfigSha256: 'abc' },
      ],
      current
    );
    expect(markers.map((m) => m.legacy)).toEqual([false, true, true, false]);
    expect(markerSummary(markers)).toEqual({ current: 2, legacy: 2 });
  });

  it('defers to a server-side legacy verdict when present', () => {
    const markers = classifySignalMarkers(
      [
        { time: '1', signal: 'BUY', signalLegacy: false },
        { time: '2', signal: 'SELL', signalLegacy: true, signalConfigSha256: 'abc' },
      ],
      current
    );
    expect(markers.map((m) => m.legacy)).toEqual([false, true]);
  });
});
