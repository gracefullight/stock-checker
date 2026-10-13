import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_QUALITY_PIPELINE_CONFIG } from '@/constants';
import {
  buildTickerContext,
  type Candle,
  evaluateLatestSignalWithContext,
  runSignalsWithContext,
  type TickerContext,
} from '@/optimization/engine';
import type { PipelineConfig } from '@/types';

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

describe('cluster consumption and gap-unit options', () => {
  // Session 205 fires and is quality-blocked; sessions 206-209 fall inside the
  // five-day window; the fixture dates are consecutive UTC days, so calendar and
  // session gaps coincide unless the dates are spread out.
  it('reproduces the validated rule when the optional fields are absent', () => {
    const context = leaderContext(true);
    const config: PipelineConfig = structuredClone(DEFAULT_QUALITY_PIPELINE_CONFIG);
    const latest = evaluateLatestSignalWithContext(context, 'LEADER', config);
    expect(latest?.pipelineResult.finalDecision).toBe('HOLD');
    expect(latest?.pipelineResult.blockedBy).toBe('cluster');
    expect(latest?.pipelineResult.cluster).toEqual({
      lastSetupDate: '2026-07-25',
      nextEligibleDate: '2026-07-30',
      gapUnit: 'calendar',
      minGap: 5,
    });
  });

  it("'buys-only' lets a quality-blocked bar leave the window open", () => {
    const context = leaderContext(true);
    const config: PipelineConfig = structuredClone(DEFAULT_QUALITY_PIPELINE_CONFIG);
    config.clusterFilter.consume = 'buys-only';
    // Session 205 no longer consumes the window, so session 206 is the first BUY;
    // that BUY then blocks sessions 207-209 as before.
    expect(runSignalsWithContext(context, 'LEADER', config).map((s) => s.date)).toEqual([
      context.data[206].date,
    ]);
    const latest = evaluateLatestSignalWithContext(context, 'LEADER', config);
    expect(latest?.pipelineResult).toMatchObject({
      finalDecision: 'HOLD',
      blockedBy: 'cluster',
      cluster: { lastSetupDate: '2026-07-26', nextEligibleDate: '2026-07-31' },
    });
  });

  it("'pullback-setups' consumes only quality-blocked bars that were already pullbacks", () => {
    const context = leaderContext(true);
    const config: PipelineConfig = structuredClone(DEFAULT_QUALITY_PIPELINE_CONFIG);
    config.clusterFilter.consume = 'pullback-setups';
    // The fixture's blocked bar closes below SMA50 with RS passing, so it still consumes.
    expect(
      evaluateLatestSignalWithContext(context, 'LEADER', config)?.pipelineResult
    ).toMatchObject({
      finalDecision: 'HOLD',
      blockedBy: 'cluster',
    });
    // Lift the blocked bar above SMA50: it is no longer a pullback and leaves the window open.
    context.sma50Arr[205 - 49] = context.data[205].close - 1;
    const first = evaluateLatestSignalWithContext(
      { ...context, data: context.data.slice(0, 206) },
      'LEADER',
      config
    );
    expect(first?.pipelineResult.qualityBlocked).toBe(true);
    expect(first?.pipelineResult.checks?.find((check) => check.id === 'below-sma50')?.passed).toBe(
      false
    );
    expect(runSignalsWithContext(context, 'LEADER', config).map((s) => s.date)).toEqual([
      context.data[206].date,
    ]);
  });

  it("'sessions' gap unit counts bars instead of calendar days", () => {
    const context = leaderContext(true);
    // Spread the last bar seven calendar days after the consumed setup, four sessions later.
    const shifted = new Date(Date.UTC(2026, 0, 205 + 1 + 7));
    context.data = context.data.map((bar, index) =>
      index === context.data.length - 1 ? { ...bar, date: shifted } : bar
    );
    // The benchmarks share the fixture's sessions (spy and sector are the same array).
    context.spy[context.spy.length - 1].date = shifted;
    const calendar = structuredClone(DEFAULT_QUALITY_PIPELINE_CONFIG);
    expect(
      evaluateLatestSignalWithContext(context, 'LEADER', calendar)?.pipelineResult.finalDecision
    ).toBe('BUY');
    const sessionsConfig: PipelineConfig = structuredClone(DEFAULT_QUALITY_PIPELINE_CONFIG);
    sessionsConfig.clusterFilter.gapUnit = 'sessions';
    const latest = evaluateLatestSignalWithContext(context, 'LEADER', sessionsConfig);
    expect(latest?.pipelineResult.finalDecision).toBe('HOLD');
    expect(latest?.pipelineResult.cluster).toMatchObject({ gapUnit: 'sessions', minGap: 5 });
    expect(latest?.pipelineResult.checks?.find((check) => check.gate === 'cluster')).toMatchObject({
      value: 4,
      limit: 5,
      passed: false,
    });
  });
});
