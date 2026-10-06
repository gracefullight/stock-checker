import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_QUALITY_PIPELINE_CONFIG } from '@/constants';
import {
  buildTickerContext,
  type Candle,
  evaluateLatestSignalWithContext,
  runSignalsWithContext,
  type TickerContext,
} from '@/optimization/engine';

// No chart-pattern observation in these fixtures; the native score and gates remain real.
vi.mock('@/services/patterns', () => ({
  detectPatterns: vi.fn().mockReturnValue({ score: 0, patterns: [] }),
}));

function leaderContext(firstSetupFailsQuality = false): TickerContext {
  const data: Candle[] = Array.from({ length: 210 }, (_, index) => {
    const close = 100 + index * 0.5;
    return {
      date: new Date(Date.UTC(2026, 0, index + 1)),
      open: close + 1,
      close,
      high: close + (index === 205 && firstSetupFailsQuality ? 1 : 9),
      low: close - 1,
      volume: 1_000_000,
    };
  });
  const benchmark = data.map((bar) => ({ ...bar, close: 100, high: 101, low: 99 }));
  const context = buildTickerContext(data, benchmark, benchmark);
  if (!context) throw new Error('fixture warmup unavailable');
  // Explicit known indicator observations isolate the setup-state contract.
  for (let index = 205; index < data.length; index++) {
    context.rsiArr[index - 14] = 55;
    context.stochArr[index - 13] = { k: 55, d: 55 };
    context.williamsArr[index - 13] = -45;
    context.sma50Arr[index - 49] = data[index].close + 1;
    context.sma200Arr[index - 199] = 100;
    context.atrArr[index] = 2;
    context.volMaArr[index] = data[index].volume / 1.1;
    context.donchUpperArr[index] = 250;
  }
  return context;
}

describe('historical and latest signal setup-state parity', () => {
  it.each([false, true])(
    'replays the same consumed setup state when the first setup quality-blocked=%s',
    (firstSetupFailsQuality) => {
      const context = leaderContext(firstSetupFailsQuality);
      const config = structuredClone(DEFAULT_QUALITY_PIPELINE_CONFIG);
      const firstBarContext = { ...context, data: context.data.slice(0, 206) };
      const first = evaluateLatestSignalWithContext(firstBarContext, 'LEADER', config);
      expect(first?.pipelineResult.finalDecision).toBe(firstSetupFailsQuality ? 'HOLD' : 'BUY');
      expect(first?.pipelineResult.qualityBlocked).toBe(firstSetupFailsQuality ? true : undefined);

      const latest = evaluateLatestSignalWithContext(context, 'LEADER', config);
      const signals = runSignalsWithContext(context, 'LEADER', config);
      expect(latest?.pipelineResult.finalDecision).toBe('HOLD');
      expect(signals.map((signal) => signal.date)).toEqual(
        firstSetupFailsQuality ? [] : [context.data[205].date]
      );
      expect(
        signals.some((signal) => signal.date.getTime() === context.data.at(-1)!.date.getTime())
      ).toBe(false);

      const withoutClustering = {
        ...config,
        clusterFilter: { ...config.clusterFilter, enabled: false },
      };
      const unblocked = evaluateLatestSignalWithContext(context, 'LEADER', withoutClustering);
      expect(unblocked?.pipelineResult.finalDecision).toBe('BUY');
    }
  );

  it('returns the same latest BUY score and gates as the historical native pipeline', () => {
    const context = leaderContext();
    // Remove earlier eligible setup dates while retaining identical causal indicator inputs.
    context.data = context.data.slice(0, 206);
    const config = structuredClone(DEFAULT_QUALITY_PIPELINE_CONFIG);
    const latest = evaluateLatestSignalWithContext(context, 'LEADER', config);
    const historical = runSignalsWithContext(context, 'LEADER', config).at(-1);
    expect(latest?.pipelineResult.finalDecision).toBe('BUY');
    expect(historical).toMatchObject({
      date: context.data.at(-1)!.date,
      decision: latest!.pipelineResult.finalDecision,
      score: latest!.pipelineResult.score,
      regime: latest!.pipelineResult.gateResults.trend.regime,
      confluenceRatio: latest!.pipelineResult.gateResults.confluence.ratio,
      rsSpy: latest!.pipelineResult.gateResults.institutional.components.rsSpy,
      rsSector: latest!.pipelineResult.gateResults.institutional.components.rsSector,
    });
  });

  it('applies current earnings only to the latest bar and preserves historical replay outputs', () => {
    const context = leaderContext();
    const config = structuredClone(DEFAULT_QUALITY_PIPELINE_CONFIG);
    const historicalBefore = runSignalsWithContext(context, 'LEADER', config);
    const unknown = evaluateLatestSignalWithContext(context, 'LEADER', config);
    const current = evaluateLatestSignalWithContext(context, 'LEADER', config, {
      earningsBeat: true,
      earningsEstimateUp: true,
    });
    expect(current?.pipelineResult.gateResults.institutional.components.earnings).toBeGreaterThan(
      unknown!.pipelineResult.gateResults.institutional.components.earnings
    );
    expect(current?.pipelineResult.finalDecision).toBe(unknown?.pipelineResult.finalDecision);
    expect(runSignalsWithContext(context, 'LEADER', config)).toEqual(historicalBefore);
  });
});
