import {
  DEFAULT_INSTITUTIONAL_CONFIG,
  DEFAULT_INSTITUTIONAL_PIPELINE_CONFIG,
  DEFAULT_PIPELINE_CONFIG,
  DEFAULT_QUALITY_PIPELINE_CONFIG,
  MEAN_REVERSION_GRADIENT_RANGES,
} from '@/constants';
import type { PipelineConfig } from '@/types';

export const MR_WEIGHTS = {
    rsi: 79,
    stochastic: 76,
    bollinger: 78,
    donchian: 74,
    williamsR: 72,
    fearGreed: 50,
    macd: 75,
    sma: 60,
    ema: 65,
    volume: 0,
  };

export const newPatternKeys = [
    'bullishPennant',
    'bearishPennant',
    'cupWithHandle',
    'invertedCupWithHandle',
    'threeRisingValleys',
    'threeDescendingPeaks',
    'ascendingScallop',
    'descendingScallop',
    'measuredMoveUp',
    'measuredMoveDown',
    'diamondBottom',
    'topsRectangle',
  ];

export const v2PatternWeights = { ...DEFAULT_PIPELINE_CONFIG.patternWeights };
  for (const k of newPatternKeys) {
    (v2PatternWeights as Record<string, number>)[k] = 0;
  }

export const v2Config: PipelineConfig = {
    ...DEFAULT_PIPELINE_CONFIG,
    strategy: 'mean-reversion',
    indicatorWeights: MR_WEIGHTS,
    gradientRanges: { ...MEAN_REVERSION_GRADIENT_RANGES },
    regimeFilter: { enabled: true, blockUptrend: true },
    institutional: { ...DEFAULT_INSTITUTIONAL_CONFIG, enabled: false },
    patternWeights: v2PatternWeights,
    trendGate: { ...DEFAULT_PIPELINE_CONFIG.trendGate, minConditions: 1, enabled: true },
    reversalConfirm: { ...DEFAULT_PIPELINE_CONFIG.reversalConfirm, enabled: false },
    thresholds: { buy: 370, sell: 200 },
    confluence: { minActive: 3, activationThreshold: 0.3 },
    confidenceGate: { ...DEFAULT_PIPELINE_CONFIG.confidenceGate, enabled: false },
  };

export const v3Config: PipelineConfig = {
    ...DEFAULT_PIPELINE_CONFIG,
    strategy: 'mean-reversion',
    indicatorWeights: MR_WEIGHTS,
    gradientRanges: { ...MEAN_REVERSION_GRADIENT_RANGES },
    regimeFilter: { enabled: true, blockUptrend: true },
    institutional: { ...DEFAULT_INSTITUTIONAL_CONFIG, enabled: false },
    trendGate: { ...DEFAULT_PIPELINE_CONFIG.trendGate, minConditions: 1, enabled: true },
    reversalConfirm: { ...DEFAULT_PIPELINE_CONFIG.reversalConfirm, enabled: false },
    thresholds: { buy: 370, sell: 200 },
    confluence: { minActive: 3, activationThreshold: 0.3 },
    confidenceGate: { ...DEFAULT_PIPELINE_CONFIG.confidenceGate, enabled: false },
  };

export const v4Config: PipelineConfig = {
    ...DEFAULT_PIPELINE_CONFIG,
    institutional: { ...DEFAULT_INSTITUTIONAL_CONFIG, enabled: false },
    trendGate: { ...DEFAULT_PIPELINE_CONFIG.trendGate, minConditions: 1, enabled: true },
    reversalConfirm: { ...DEFAULT_PIPELINE_CONFIG.reversalConfirm, enabled: false },
    confidenceGate: { ...DEFAULT_PIPELINE_CONFIG.confidenceGate, enabled: false },
  };

  // V5 = institutional (flow-primary + gaussian trend + blended institutional).
  // Kept RAW (no quality gate) so the Phase-4 goal search runs on the unfiltered
  // signal set — otherwise the search would re-filter an already-filtered input.
export const v5Config: PipelineConfig = {
    ...DEFAULT_INSTITUTIONAL_PIPELINE_CONFIG,
  };

  // V7 = institutional + the LEGACY entry-quality gate (rs.5, scr<380, no
  // market/stage filter) — pinned explicitly so the comparison row stays stable
  // even as the shipped default gate evolves. Evaluated through the REAL
  // pipeline (Gate 1.7), not as a post-hoc filter.
export const LEGACY_V7_GATE = {
    enabled: true,
    ibsMax: 0.3,
    atrPctMax: 3.5,
    volRMin: 0.8,
    volRMax: 99,
    scoreMax: 380,
    rsMin: 0.5,
    requireBelowSma50: true,
  };
export const v7Config: PipelineConfig = {
    ...DEFAULT_INSTITUTIONAL_PIPELINE_CONFIG,
    qualityGate: LEGACY_V7_GATE,
  };

  // V9 = V7 + market kill-switch (essay #2 at the index level): no new BUYs
  // while the SPY Gaussian Channel is red. Targets the 2020-type crash regime
  // where leader-pullback entries lose their edge.
export const v9Config: PipelineConfig = {
    ...DEFAULT_INSTITUTIONAL_PIPELINE_CONFIG,
    qualityGate: { ...LEGACY_V7_GATE, requireMarketUptrend: true },
  };

  // V10 = the SHIPPED default gate (strong-leader pullback: rs.7 + scr<400 +
  // market kill-switch + above-200d stage filter) — the WR+R/R dominance config.
export const v10Config: PipelineConfig = {
    ...DEFAULT_QUALITY_PIPELINE_CONFIG,
  };

export const v2Signals: BacktestSignal[] = [];
export const v3Signals: BacktestSignal[] = [];
export const v4Signals: BacktestSignal[] = [];
export const v5Signals: BacktestSignal[] = [];
export const v7Signals: BacktestSignal[] = [];
export const v9Signals: BacktestSignal[] = [];
export const v10Signals: BacktestSignal[] = [];
  for (const [ticker, ctx] of ctxMap) {
    v2Signals.push(...runSignalsWithContext(ctx, ticker, v2Config));
    v3Signals.push(...runSignalsWithContext(ctx, ticker, v3Config));
    v4Signals.push(...runSignalsWithContext(ctx, ticker, v4Config));
    v5Signals.push(...runSignalsWithContext(ctx, ticker, v5Config));
    v7Signals.push(...runSignalsWithContext(ctx, ticker, v7Config));
    v9Signals.push(...runSignalsWithContext(ctx, ticker, v9Config));
    v10Signals.push(...runSignalsWithContext(ctx, ticker, v10Config));
  }

  // Entry years actually present in the signal set — derived, not hardcoded,
  // so widening HISTORY_DAYS automatically extends every per-year breakdown.
export const ENTRY_YEARS = [...new Set(v5Signals.map((s) => s.date.toISOString().slice(0, 4)))].sort();

export const v2Result = measure5DayWinRate(v2Signals, priceData, COST_PCT);
export const v3Result = measure5DayWinRate(v3Signals, priceData, COST_PCT);
export const v4Result = measure5DayWinRate(v4Signals, priceData, COST_PCT);
export const v5Result = measure5DayWinRate(v5Signals, priceData, COST_PCT);
  // V6 = same institutional entries as V5, but exit on Gaussian Channel flip (trend-hold).
export const v6Result = measureTrendHoldWinRate(v5Signals, priceData, { costPct: COST_PCT });
  // V7 = institutional + entry-quality gate, through the real pipeline (the shipped improvement).
export const v7Result = measure5DayWinRate(v7Signals, priceData, COST_PCT);
  // V9 = V7 + SPY-Gaussian market kill-switch, through the real pipeline.
export const v9Result = measure5DayWinRate(v9Signals, priceData, COST_PCT);
  // V10 = the shipped default gate (strong-leader pullback + market/stage filters).
export const v10Result = measure5DayWinRate(v10Signals, priceData, COST_PCT);

  console.log(
    `\n${'Version'.padEnd(20)} | ${'WinRate'.padStart(8)} | ${'Signals'.padStart(8)} | ${'AvgRet'.padStart(8)} | ${'R/R'.padStart(6)} | ${'Sig/Mo'.padStart(6)}`
  );
  console.log('-'.repeat(72));
export const fmtRow = (name: string, r: WinRateResult) =>
    `${name.padEnd(20)} | ${(`${r.winRate5d.toFixed(1)}%`).padStart(8)} | ${String(r.totalSignals).padStart(8)} | ${(`${r.avgReturn.toFixed(2)}%`).padStart(8)} | ${r.rewardRisk.toFixed(2).padStart(6)} | ${r.signalsPerMonth.toFixed(1).padStart(6)}`;
  console.log(fmtRow('V2', v2Result));
  console.log(fmtRow('V3', v3Result));
  console.log(fmtRow('V4 (momentum)', v4Result));
  console.log(fmtRow('V5 (institutional)', v5Result));
  console.log(fmtRow('V6 (V5 + trend-hold)', v6Result));
  console.log(fmtRow('V7 (V5 + quality)', v7Result));
  console.log(fmtRow('V9 (V7 + mkt switch)', v9Result));
  console.log(fmtRow('V10 (shipped gate)', v10Result));
  console.log(
    '\n🎯 V7 = shipped improvement (institutional + entry-quality gate, via real pipeline):'
  );
  console.log(
    `  WR ${v7Result.winRate5d.toFixed(1)}% (vs V5 ${v5Result.winRate5d.toFixed(1)}%)  |  R/R ${v7Result.rewardRisk.toFixed(2)} (vs V5 ${v5Result.rewardRisk.toFixed(2)})  |  N ${v7Result.totalSignals}  |  AvgRet ${v7Result.avgReturn.toFixed(2)}%`
  );
export const v7GoalMet = v7Result.winRate5d >= 60 && v7Result.rewardRisk > v5Result.rewardRisk;
  console.log(
    `  ${v7GoalMet ? '✅ GOAL MET' : '⚠️ goal NOT met'}: WR ≥ 60% AND R/R > baseline (${v5Result.rewardRisk.toFixed(2)})`
  );
  console.log('  V7 by entry year:');
  for (const yr of ENTRY_YEARS) {
  export const sub = v7Signals.filter((s) => s.date.toISOString().slice(0, 4) === yr);
    if (sub.length === 0) continue;
  export const r = measure5DayWinRate(sub, priceData, COST_PCT);
    console.log(
      `    ${yr}: WR=${r.winRate5d.toFixed(1)}%  R/R=${r.rewardRisk.toFixed(2)}  N=${r.totalSignals}  AvgRet=${r.avgReturn.toFixed(2)}%`
    );
  }
  console.log(
    `\n🎯 V9 = V7 + market kill-switch (no BUY while SPY Gaussian is red), via real pipeline:`
  );
  console.log(
    `  WR ${v9Result.winRate5d.toFixed(1)}% (vs V7 ${v7Result.winRate5d.toFixed(1)}%)  |  R/R ${v9Result.rewardRisk.toFixed(2)} (vs V7 ${v7Result.rewardRisk.toFixed(2)})  |  N ${v9Result.totalSignals}  |  AvgRet ${v9Result.avgReturn.toFixed(2)}%`
  );
  console.log('  V9 by entry year:');
  for (const yr of ENTRY_YEARS) {
  export const sub = v9Signals.filter((s) => s.date.toISOString().slice(0, 4) === yr);
    if (sub.length === 0) continue;
  export const r = measure5DayWinRate(sub, priceData, COST_PCT);
    console.log(
      `    ${yr}: WR=${r.winRate5d.toFixed(1)}%  R/R=${r.rewardRisk.toFixed(2)}  N=${r.totalSignals}  AvgRet=${r.avgReturn.toFixed(2)}%`
    );
  }
  console.log(
    '\n🎯 V10 = SHIPPED default gate (rs.7 + scr<400 + market kill-switch + 200d stage), via real pipeline:'
  );
  console.log(
    `  WR ${v10Result.winRate5d.toFixed(1)}% (vs V7 ${v7Result.winRate5d.toFixed(1)}%)  |  R/R ${v10Result.rewardRisk.toFixed(2)} (vs V7 ${v7Result.rewardRisk.toFixed(2)})  |  N ${v10Result.totalSignals}  |  AvgRet ${v10Result.avgReturn.toFixed(2)}%`
  );
export const v10GoalMet = v10Result.winRate5d >= 70 && v10Result.rewardRisk >= v7Result.rewardRisk;
  console.log(
    `  ${v10GoalMet ? '✅ DOMINANCE GOAL MET' : '⚠️ dominance goal NOT met'}: WR ≥ 70% AND R/R ≥ V7 (${v7Result.rewardRisk.toFixed(2)})`
  );
  console.log('  V10 by entry year:');
  for (const yr of ENTRY_YEARS) {
  export const sub = v10Signals.filter((s) => s.date.toISOString().slice(0, 4) === yr);
    if (sub.length === 0) continue;
  export const r = measure5DayWinRate(sub, priceData, COST_PCT);
    console.log(
      `    ${yr}: WR=${r.winRate5d.toFixed(1)}%  R/R=${r.rewardRisk.toFixed(2)}  N=${r.totalSignals}  AvgRet=${r.avgReturn.toFixed(2)}%`
    );
  }

  // Quality-gate parameter tuning — evaluated through the REAL pipeline (not a
  // post-hoc filter), so the cluster-filter interaction is accounted for. Picks
  // the gate that best satisfies the goal with margin AND the strongest weakest
  // entry-year (robustness), not just the best aggregate.
  console.log('\nQuality-gate tuning (via real pipeline; min-year = weakest entry-year WR):');
  console.log(
    `${'Gate params'.padEnd(34)} | ${'WinRate'.padStart(7)} | ${'R/R'.padStart(5)} | ${'N'.padStart(5)} | ${'AvgRet'.padStart(7)} | ${'minYr'.padStart(6)}`
  );
export const gateVariants: { name: string; gate: NonNullable<PipelineConfig['qualityGate']> }[] = [
    {
      name: 'ibs.30 atr3.5 vol.8-2.0',
      gate: { enabled: true, ibsMax: 0.3, atrPctMax: 3.5, volRMin: 0.8, volRMax: 2.0 },
    },
    {
      name: 'ibs.25 atr3.5 vol.8-2.0',
      gate: { enabled: true, ibsMax: 0.25, atrPctMax: 3.5, volRMin: 0.8, volRMax: 2.0 },
    },
    {
      name: 'ibs.20 atr3.5 vol.8-2.0',
      gate: { enabled: true, ibsMax: 0.2, atrPctMax: 3.5, volRMin: 0.8, volRMax: 2.0 },
    },
    {
      name: 'ibs.20 atr3.0 vol.8-2.0',
      gate: { enabled: true, ibsMax: 0.2, atrPctMax: 3.0, volRMin: 0.8, volRMax: 2.0 },
    },
    {
      name: 'ibs.20 atr3.5 vol.8-1.5',
      gate: { enabled: true, ibsMax: 0.2, atrPctMax: 3.5, volRMin: 0.8, volRMax: 1.5 },
    },
    {
      name: 'ibs.15 atr3.5 vol.8-2.0',
      gate: { enabled: true, ibsMax: 0.15, atrPctMax: 3.5, volRMin: 0.8, volRMax: 2.0 },
    },
    // Essay #1 anti-blowoff: add a buyScore cap (every top generalizing config had scr<380/400).
    {
      name: 'ibs.30 atr3.5 vol.8-2.0 scr<400',
      gate: {
        enabled: true,
        ibsMax: 0.3,
        atrPctMax: 3.5,
        volRMin: 0.8,
        volRMax: 2.0,
        scoreMax: 400,
      },
    },
    {
      name: 'ibs.30 atr3.5 vol.8-2.0 scr<380',
      gate: {
        enabled: true,
        ibsMax: 0.3,
        atrPctMax: 3.5,
        volRMin: 0.8,
        volRMax: 2.0,
        scoreMax: 380,
      },
    },
    {
      name: 'ibs.30 atr3.5 vol.8-1.5 scr<400',
      gate: {
        enabled: true,
        ibsMax: 0.3,
        atrPctMax: 3.5,
        volRMin: 0.8,
        volRMax: 1.5,
        scoreMax: 400,
      },
    },
    {
      name: 'ibs.30 atr4 vol.8-1.5 scr<400',
      gate: { enabled: true, ibsMax: 0.3, atrPctMax: 4, volRMin: 0.8, volRMax: 1.5, scoreMax: 400 },
    },
    // Essay #1 leader-pullback (주도주 눌림목): strong RS vs market AND sector,
    // pulled back below the 50-day line, calm, weak intraday close, real volume.
    // Top generalizing family from the diversified-universe Phase-4 search.
    {
      name: 'LDR rs.5+50b ibs.3 atr3.5 scr380',
      gate: {
        enabled: true,
        ibsMax: 0.3,
        atrPctMax: 3.5,
        volRMin: 0.8,
        volRMax: 99,
        scoreMax: 380,
        rsMin: 0.5,
        requireBelowSma50: true,
      },
    },
    {
      name: 'LDR rs.5+50b ibs.3 atr3.5',
      gate: {
        enabled: true,
        ibsMax: 0.3,
        atrPctMax: 3.5,
        volRMin: 0.8,
        volRMax: 99,
        rsMin: 0.5,
        requireBelowSma50: true,
      },
    },
    {
      name: 'LDR rs.5 only ibs.3 atr3.5',
      gate: {
        enabled: true,
        ibsMax: 0.3,
        atrPctMax: 3.5,
        volRMin: 0.8,
        volRMax: 99,
        rsMin: 0.5,
      },
    },
    {
      name: 'LDR 50b only ibs.3 atr3.5',
      gate: {
        enabled: true,
        ibsMax: 0.3,
        atrPctMax: 3.5,
        volRMin: 0.8,
        volRMax: 99,
        requireBelowSma50: true,
      },
    },
    {
      name: 'LDR rs.7+50b ibs.3 atr3.5',
      gate: {
        enabled: true,
        ibsMax: 0.3,
        atrPctMax: 3.5,
        volRMin: 0.8,
        volRMax: 99,
        rsMin: 0.7,
        requireBelowSma50: true,
      },
    },
    // Strong-leader family (rs ≥ 0.7): the highest real-pipeline WR-with-R/R
    // lever found so far (essay #1 — "is it stronger than everything else?").
    // Crossed with the market kill-switch and the stage filter.
    {
      name: 'LDR7 + mktUp',
      gate: {
        enabled: true,
        ibsMax: 0.3,
        atrPctMax: 3.5,
        volRMin: 0.8,
        volRMax: 99,
        rsMin: 0.7,
        requireBelowSma50: true,
        requireMarketUptrend: true,
      },
    },
    {
      name: 'LDR7 + 200a',
      gate: {
        enabled: true,
        ibsMax: 0.3,
        atrPctMax: 3.5,
        volRMin: 0.8,
        volRMax: 99,
        rsMin: 0.7,
        requireBelowSma50: true,
        requireAboveSma200: true,
      },
    },
    {
      name: 'LDR7 + mktUp + 200a',
      gate: {
        enabled: true,
        ibsMax: 0.3,
        atrPctMax: 3.5,
        volRMin: 0.8,
        volRMax: 99,
        rsMin: 0.7,
        requireBelowSma50: true,
        requireMarketUptrend: true,
        requireAboveSma200: true,
      },
    },
    {
      name: 'LDR7 + scr400',
      gate: {
        enabled: true,
        ibsMax: 0.3,
        atrPctMax: 3.5,
        volRMin: 0.8,
        volRMax: 99,
        scoreMax: 400,
        rsMin: 0.7,
        requireBelowSma50: true,
      },
    },
    {
      name: 'LDR8 (rs.8)',
      gate: {
        enabled: true,
        ibsMax: 0.3,
        atrPctMax: 3.5,
        volRMin: 0.8,
        volRMax: 99,
        rsMin: 0.8,
        requireBelowSma50: true,
      },
    },
    {
      name: 'LDR7 + ibs.25',
      gate: {
        enabled: true,
        ibsMax: 0.25,
        atrPctMax: 3.5,
        volRMin: 0.8,
        volRMax: 99,
        rsMin: 0.7,
        requireBelowSma50: true,
      },
    },
    {
      name: 'LDR7 + scr400 + mktUp',
      gate: {
        enabled: true,
        ibsMax: 0.3,
        atrPctMax: 3.5,
        volRMin: 0.8,
        volRMax: 99,
        scoreMax: 400,
        rsMin: 0.7,
        requireBelowSma50: true,
        requireMarketUptrend: true,
      },
    },
    {
      name: 'LDR7 + scr400 + 200a',
      gate: {
        enabled: true,
        ibsMax: 0.3,
        atrPctMax: 3.5,
        volRMin: 0.8,
        volRMax: 99,
        scoreMax: 400,
        rsMin: 0.7,
        requireBelowSma50: true,
        requireAboveSma200: true,
      },
    },
    {
      name: 'LDR7 + scr400 + mktUp + 200a',
      gate: {
        enabled: true,
        ibsMax: 0.3,
        atrPctMax: 3.5,
        volRMin: 0.8,
        volRMax: 99,
        scoreMax: 400,
        rsMin: 0.7,
        requireBelowSma50: true,
        requireMarketUptrend: true,
        requireAboveSma200: true,
      },
    },
    {
      name: 'LDR7 + scr380',
      gate: {
        enabled: true,
        ibsMax: 0.3,
        atrPctMax: 3.5,
        volRMin: 0.8,
        volRMax: 99,
        scoreMax: 380,
        rsMin: 0.7,
        requireBelowSma50: true,
      },
    },
    // One-shot greed pass on top of the shipped V10 champion — each variant
    // adds a single extra condition. Tiny-N results here are read as noise,
    // not edge (hard-won rule #4: families over lone spikes).
    {
      name: 'V10 + ibs.25',
      gate: { ...DEFAULT_QUALITY_PIPELINE_CONFIG.qualityGate, ibsMax: 0.25 },
    },
    {
      name: 'V10 + atr3.0',
      gate: { ...DEFAULT_QUALITY_PIPELINE_CONFIG.qualityGate, atrPctMax: 3.0 },
    },
    {
      name: 'V10 + rs.75',
      gate: { ...DEFAULT_QUALITY_PIPELINE_CONFIG.qualityGate, rsMin: 0.75 },
    },
    {
      name: 'V10 + vwap.5',
      gate: { ...DEFAULT_QUALITY_PIPELINE_CONFIG.qualityGate, vwapMin: 0.5 },
    },
    {
      name: 'V10 + volR<2',
      gate: { ...DEFAULT_QUALITY_PIPELINE_CONFIG.qualityGate, volRMax: 2.0 },
    },
    // Final ibs-family pass: ibs<0.25 improved WR AND avgRet at R/R parity on
    // both the 408 and 546 universes — test its immediate neighbors once.
    {
      name: 'V10 + ibs.25 + atr3.0',
      gate: { ...DEFAULT_QUALITY_PIPELINE_CONFIG.qualityGate, ibsMax: 0.25, atrPctMax: 3.0 },
    },
    {
      name: 'V10 + ibs.20',
      gate: { ...DEFAULT_QUALITY_PIPELINE_CONFIG.qualityGate, ibsMax: 0.2 },
    },
    {
      name: 'V10 + ibs.25 + scr380',
      gate: { ...DEFAULT_QUALITY_PIPELINE_CONFIG.qualityGate, ibsMax: 0.25, scoreMax: 380 },
    },
    // Market kill-switch (essay #2 at the index level) and VWAP accumulation
    // (essay #1) variants — the WR+R/R dominance candidates from the goal search,
    // re-validated through the REAL pipeline.
    {
      name: 'LDR + mktUp (V9)',
      gate: {
        enabled: true,
        ibsMax: 0.3,
        atrPctMax: 3.5,
        volRMin: 0.8,
        volRMax: 99,
        scoreMax: 380,
        rsMin: 0.5,
        requireBelowSma50: true,
        requireMarketUptrend: true,
      },
    },
    {
      name: 'LDR + mktUp + vwap.5',
      gate: {
        enabled: true,
        ibsMax: 0.3,
        atrPctMax: 3.5,
        volRMin: 0.8,
        volRMax: 99,
        scoreMax: 380,
        rsMin: 0.5,
        requireBelowSma50: true,
        requireMarketUptrend: true,
        vwapMin: 0.5,
      },
    },
    {
      name: 'LDR + mktUp + 200a',
      gate: {
        enabled: true,
        ibsMax: 0.3,
        atrPctMax: 3.5,
        volRMin: 0.8,
        volRMax: 99,
        scoreMax: 380,
        rsMin: 0.5,
        requireBelowSma50: true,
        requireMarketUptrend: true,
        requireAboveSma200: true,
      },
    },
    {
      name: 'LDR + mktUp + 200a + vwap.5',
      gate: {
        enabled: true,
        ibsMax: 0.3,
        atrPctMax: 3.5,
        volRMin: 0.8,
        volRMax: 99,
        scoreMax: 380,
        rsMin: 0.5,
        requireBelowSma50: true,
        requireMarketUptrend: true,
        requireAboveSma200: true,
        vwapMin: 0.5,
      },
    },
    {
      name: 'deepIBS.12 scr<400 50b + mktUp',
      gate: {
        enabled: true,
        ibsMax: 0.12,
        atrPctMax: 3.5,
        volRMin: 0,
        volRMax: 2.0,
        scoreMax: 400,
        requireBelowSma50: true,
        requireMarketUptrend: true,
      },
    },
    {
      name: 'vwap+ rs.5 vR.8-1.2 + mktUp',
      gate: {
        enabled: true,
        ibsMax: 99,
        atrPctMax: 3.5,
        volRMin: 0.8,
        volRMax: 1.2,
        scoreMax: 400,
        rsMin: 0.5,
        requireBelowSma50: true,
        requireMarketUptrend: true,
        vwapMin: 0.5,
      },
    },
  ];
