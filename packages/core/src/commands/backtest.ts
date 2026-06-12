/**
 * Backtest command — runs Pipeline V4 (momentum) vs V3/V2 against historical price data
 * and measures 5-day directional win rate.
 */
import {
  DEFAULT_INSTITUTIONAL_CONFIG,
  DEFAULT_INSTITUTIONAL_PIPELINE_CONFIG,
  DEFAULT_PIPELINE_CONFIG,
  DEFAULT_QUALITY_PIPELINE_CONFIG,
  DEFAULT_ROUND_TRIP_COST_PCT,
  MEAN_REVERSION_GRADIENT_RANGES,
} from '@/constants';
import { DataLoader } from '@/optimization/data-loader';
import { type BacktestSignal,
  buildTickerContext,
  measure5DayWinRate,
  runSignalsWithContext,
  type TickerContext,
  type WinRateResult,, measureSellAccuracy, measureTrendHoldWinRate, type SellAccuracyResult } from '@/optimization/engine';
import { POST_FILTERS } from '@/optimization/filters';
import { v2Config, v3Config, v4Config, v5Config, v7Config, v9Config, v10Config, gateVariants } from '@/optimization/backtest-configs';

import { gaussianChannel } from '@/services/gaussian-channel';
import yahooFinance from '@/services/yahoo-finance';
import type { BenchmarkCandle, PipelineConfig } from '@/types';
import { TICKER_SECTOR_ETF } from '@/constants/tickers';

// History window per ticker (calendar days). 8y so the 205-bar warm-up clears
// mid-2019, making 2020 (COVID crash) and 2022 (rate-hike bear) full entry
// years — the edge must survive bear regimes, not just the 2023-26 bull.
// Tickers that IPO'd later simply contribute shorter series.
const HISTORY_DAYS = 2920;




export async function backtest(opts: { costBps?: number; quick?: boolean } = {}) {
  // Round-trip transaction cost applied to every simulated trade. All WR/R-R
  // numbers below are NET of this cost; a "win" means profitable after costs.
  const COST_PCT = opts.costBps != null ? opts.costBps / 100 : DEFAULT_ROUND_TRIP_COST_PCT;
  console.log(
    `Transaction cost model: ${(COST_PCT * 100).toFixed(0)}bps round-trip deducted from every trade\n`
  );
  const tickers = Object.keys(TICKER_SECTOR_ETF);

  console.log('Loading historical data for', tickers.length, 'tickers...');
  const allData = new Map<
    string,
    { date: Date; open: number; high: number; low: number; close: number; volume: number }[]
  >();

  // Fetch in parallel batches (bounded concurrency — polite to the data API).
  const FETCH_CONCURRENCY = 6;
  for (let b = 0; b < tickers.length; b += FETCH_CONCURRENCY) {
    const batch = tickers.slice(b, b + FETCH_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (ticker) => ({
        ticker,
        data: await DataLoader.loadHistoricalData(ticker, HISTORY_DAYS),
      }))
    );
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      const { ticker, data } = r.value;
      if (data.length >= 210) {
        allData.set(ticker, data);
        console.log(
          `  ${ticker}: ${data.length} bars (${data[0].date.toISOString().slice(0, 10)} ~ ${data[data.length - 1].date.toISOString().slice(0, 10)})`
        );
      } else {
        console.log(`  ${ticker}: ${data.length} bars (skipped, < 210)`);
      }
    }
  }

  console.log(`Loaded data for ${allData.size} tickers\n`);

  // Market-cap tier per ticker (AS-OF-TODAY caps — point-in-time caps are not
  // available, so a 2019 small cap that 10×'d is classified by what it is now;
  // read tier splits with that bias in mind). Batched quote calls, 50/chunk.
  const capByTicker = new Map<string, number>();
  const loadedTickers = [...allData.keys()];
  for (let b = 0; b < loadedTickers.length; b += 50) {
    const chunk = loadedTickers.slice(b, b + 50);
    try {
      const quotes = await yahooFinance.quote(chunk);
      for (const q of Array.isArray(quotes) ? quotes : [quotes]) {
        if (q?.symbol && typeof q.marketCap === 'number') capByTicker.set(q.symbol, q.marketCap);
      }
    } catch {
      /* chunk failed — those tickers stay 'unknown' */
    }
  }
  type CapTier = 'large' | 'mid' | 'small' | 'unknown';
  const tierOf = (t: string): CapTier => {
    const c = capByTicker.get(t);
    if (c === undefined) return 'unknown';
    return c >= 10e9 ? 'large' : c >= 2e9 ? 'mid' : 'small';
  };
  const tierCounts: Record<CapTier, number> = { large: 0, mid: 0, small: 0, unknown: 0 };
  for (const t of loadedTickers) tierCounts[tierOf(t)]++;
  console.log(
    `Market-cap tiers (today): large(≥$10B)=${tierCounts.large}  mid($2-10B)=${tierCounts.mid}  small(<$2B)=${tierCounts.small}  unknown=${tierCounts.unknown}\n`
  );

  // Market benchmark (SPY) for relative strength (rsSpy) — loaded once, no lookahead.
  let spyData: BenchmarkCandle[] = [];
  try {
    spyData = await DataLoader.loadHistoricalData('SPY', HISTORY_DAYS);
    console.log(`SPY benchmark: ${spyData.length} bars\n`);
  } catch {
    console.log('SPY benchmark unavailable — relative strength stays 0\n');
  }

  // Sector ETFs for sector relative strength (rsSector) — loaded once.
  const sectorData = new Map<string, BenchmarkCandle[]>();
  const neededEtfs = [
    ...new Set([...allData.keys()].map((t) => TICKER_SECTOR_ETF[t]).filter(Boolean)),
  ];
  for (const etf of neededEtfs) {
    try {
      sectorData.set(etf, await DataLoader.loadHistoricalData(etf, HISTORY_DAYS));
    } catch {
      /* skip */
    }
  }
  console.log(`Sector ETFs loaded: ${[...sectorData.keys()].join(', ')}\n`);

  // Price data for win rate measurement
  const priceData = new Map<string, { date: Date; close: number }[]>();
  for (const [ticker, data] of allData) {
    priceData.set(
      ticker,
      data.map((d) => ({ date: d.date, close: d.close }))
    );
  }

  // Build the config-INDEPENDENT context ONCE per ticker (indicators, benchmark
  // alignment, dollar volume). Every config pass below reuses these — the heavy
  // per-ticker math runs 59× total instead of 59× per pass.
  const ctxMap = new Map<string, TickerContext>();
  for (const [ticker, data] of allData) {
    const sec = sectorData.get(TICKER_SECTOR_ETF[ticker]) ?? [];
    const ctx = buildTickerContext(data, spyData, sec);
    if (ctx) ctxMap.set(ticker, ctx);
  }
  console.log(`Built reusable indicator context for ${ctxMap.size} tickers\n`);

  // Phase 0: V2 vs V3 vs V4 comparison
  // V2 = mean-reversion, no new patterns, no institutional
  // V3 = mean-reversion, all patterns, no institutional
  // V4 = momentum/institutional accumulation strategy (new default)
  console.log('\n\n📋 Phase 0: V2 vs V3 vs V4 Pipeline Comparison');
  console.log('='.repeat(130));
  console.log('V2 = mean-reversion, institutional disabled, new patterns zeroed');
  console.log('V3 = mean-reversion, institutional disabled, new patterns active');
  console.log('V4 = momentum/institutional accumulation strategy (new default)');

  const sigsByVariant = new Map<string, BacktestSignal[]>();
  for (const variant of gateVariants) {
    const cfg: PipelineConfig = { ...DEFAULT_QUALITY_PIPELINE_CONFIG, qualityGate: variant.gate };
    const sigs: BacktestSignal[] = [];
    for (const [ticker, ctx] of ctxMap) {
      sigs.push(...runSignalsWithContext(ctx, ticker, cfg));
    }
    sigsByVariant.set(variant.name, sigs);
    const r = measure5DayWinRate(sigs, priceData, COST_PCT);
    let minYr = 100;
    for (const yr of ENTRY_YEARS) {
      const sub = sigs.filter((s) => s.date.toISOString().slice(0, 4) === yr);
      if (sub.length < 15) continue; // ignore tiny (partial-year) samples
      minYr = Math.min(minYr, measure5DayWinRate(sub, priceData, COST_PCT).winRate5d);
    }
    console.log(
      `${variant.name.padEnd(34)} | ${`${r.winRate5d.toFixed(1)}%`.padStart(7)} | ${r.rewardRisk.toFixed(2).padStart(5)} | ${String(r.totalSignals).padStart(5)} | ${`${r.avgReturn.toFixed(2)}%`.padStart(7)} | ${`${minYr.toFixed(1)}%`.padStart(6)}`
    );
  }

  // Deep-dive on the strong-leader (rs ≥ 0.7) family — the WR+R/R dominance
  // candidates. Train/holdout split (hard-won rule #4) + per-year robustness,
  // all through the real pipeline, net of costs.
  console.log('\n🔬 Strong-leader family deep-dive (train ≤2024 / holdout ≥2025, real pipeline):');
  for (const name of [
    'LDR rs.7+50b ibs.3 atr3.5',
    'LDR7 + mktUp',
    'LDR7 + 200a',
    'LDR7 + mktUp + 200a',
    'LDR7 + scr400',
    'LDR7 + scr400 + mktUp',
    'LDR7 + scr400 + 200a',
    'LDR7 + scr400 + mktUp + 200a',
    'LDR7 + scr380',
    'LDR8 (rs.8)',
    'LDR7 + ibs.25',
    'V10 + ibs.25',
    'V10 + atr3.0',
    'V10 + rs.75',
    'V10 + vwap.5',
    'V10 + volR<2',
    'V10 + ibs.25 + atr3.0',
    'V10 + ibs.20',
    'V10 + ibs.25 + scr380',
  ]) {
    const sigs = sigsByVariant.get(name);
    if (!sigs) continue;
    const train = sigs.filter((s) => s.date.toISOString().slice(0, 4) <= '2024');
    const test = sigs.filter((s) => s.date.toISOString().slice(0, 4) >= '2025');
    const a = measure5DayWinRate(sigs, priceData, COST_PCT);
    const tr = measure5DayWinRate(train, priceData, COST_PCT);
    const te = measure5DayWinRate(test, priceData, COST_PCT);
    console.log(`  ${name}`);
    console.log(
      `    FULL : WR=${a.winRate5d.toFixed(1)}%  R/R=${a.rewardRisk.toFixed(2)}  N=${a.totalSignals}  avgRet=${a.avgReturn.toFixed(2)}%`
    );
    console.log(
      `    TRAIN: WR=${tr.winRate5d.toFixed(1)}%  R/R=${tr.rewardRisk.toFixed(2)}  N=${tr.totalSignals}   HOLDOUT: WR=${te.winRate5d.toFixed(1)}%  R/R=${te.rewardRisk.toFixed(2)}  N=${te.totalSignals}`
    );
    const years: string[] = [];
    for (const yr of ENTRY_YEARS) {
      const sub = sigs.filter((s) => s.date.toISOString().slice(0, 4) === yr);
      if (sub.length === 0) continue;
      const r = measure5DayWinRate(sub, priceData, COST_PCT);
      years.push(`${yr} ${r.winRate5d.toFixed(0)}%/${r.totalSignals}`);
    }
    console.log(`    BY YR: ${years.join('  ')}`);
  }

  // Market-cap tier breakdown — where does the leader-pullback edge actually
  // live? Same signals, segmented by (as-of-today) cap tier, full + holdout.
  console.log(
    '\n📊 Market-cap tier breakdown (as-of-today caps; large ≥$10B / mid $2-10B / small <$2B):'
  );
  const tierRows: [string, BacktestSignal[]][] = [
    ['V10 shipped (rs.7 + scr<400)', v10Signals],
    ['V10 + ibs.25', sigsByVariant.get('V10 + ibs.25') ?? []],
    ['V7 legacy (rs.5 + scr<380)', v7Signals],
    ['V5 baseline (no gate)', v5Signals],
  ];
  for (const [name, sigs] of tierRows) {
    console.log(`  ${name}:`);
    for (const tier of ['large', 'mid', 'small', 'unknown'] as const) {
      const sub = sigs.filter((s) => tierOf(s.ticker) === tier);
      const r = measure5DayWinRate(sub, priceData, COST_PCT);
      if (r.totalSignals === 0) continue;
      const hold = sub.filter((s) => s.date.toISOString().slice(0, 4) >= '2025');
      const h = measure5DayWinRate(hold, priceData, COST_PCT);
      console.log(
        `    ${tier.padEnd(7)}: WR=${r.winRate5d.toFixed(1).padStart(5)}%  R/R=${r.rewardRisk.toFixed(2)}  N=${String(r.totalSignals).padStart(5)}  avgRet=${r.avgReturn.toFixed(2)}%  | holdout WR=${h.totalSignals > 0 ? h.winRate5d.toFixed(1) : '—'}% N=${h.totalSignals}`
      );
    }
  }

  if (opts.quick) {
    console.log('\n(quick mode — skipping diagnostics, post-hoc filters, grid and goal search)');
    return;
  }

  // Essay #2 exit ("ride the trend, exit on the Gaussian flip") applied to the
  // quality entries — does the essay-faithful exit raise R/R while keeping a
  // respectable win rate vs the fixed 5-day exit?
  console.log('\nV8 = quality entry + essay exit (Gaussian trend-hold), by entry year:');
  console.log(
    `${'Exit'.padEnd(22)} | ${'WinRate'.padStart(7)} | ${'AvgRet'.padStart(7)} | ${'PerBar'.padStart(7)} | ${'R/R'.padStart(5)} | ${'N'.padStart(5)} | ${'Hold'.padStart(5)}`
  );
  const v8Exits: { name: string; opts: Parameters<typeof measureTrendHoldWinRate>[2] }[] = [
    { name: 'fixed 5-day (V7)', opts: undefined as never },
    { name: 'trend-hold flip', opts: { exitRule: 'flip', stopPct: 8 } },
    { name: 'trend-hold mid', opts: { exitRule: 'mid', stopPct: 8 } },
  ];
  for (const ex of v8Exits) {
    const r =
      ex.opts === undefined
        ? measure5DayWinRate(v7Signals, priceData, COST_PCT)
        : measureTrendHoldWinRate(v7Signals, priceData, { ...ex.opts, costPct: COST_PCT });
    const pb = r.avgHoldBars > 0 ? r.avgReturn / r.avgHoldBars : 0;
    console.log(
      `${ex.name.padEnd(22)} | ${`${r.winRate5d.toFixed(1)}%`.padStart(7)} | ${`${r.avgReturn.toFixed(2)}%`.padStart(7)} | ${`${pb.toFixed(3)}%`.padStart(7)} | ${r.rewardRisk.toFixed(2).padStart(5)} | ${String(r.totalSignals).padStart(5)} | ${r.avgHoldBars.toFixed(1).padStart(5)}`
    );
  }

  // ==========================================================================
  // SELL signal validation — the SELL path bypasses every buy-side gate, so it
  // has never been win-rate validated. A SELL "hit" = price LOWER after the
  // horizon. Edge = accuracy − all-bars base down-rate (the universe drifts up,
  // so the base rate is the honest yardstick, not 50%).
  // ==========================================================================
  console.log('\n📉 SELL signal validation (institutional pipeline SELLs):');
  const sellSignals = v5Signals.filter((s) => s.decision === 'SELL');
  console.log(`Total SELL signals: ${sellSignals.length}`);
  if (sellSignals.length > 0) {
    console.log(
      `${'Horizon'.padEnd(8)} | ${'Accuracy'.padStart(8)} | ${'BaseDown'.padStart(8)} | ${'Edge'.padStart(7)} | ${'AvgRet'.padStart(7)} | ${'R/R'.padStart(5)} | ${'N'.padStart(5)}`
    );
    for (const h of [1, 3, 5, 10, 20]) {
      // Base rate: fraction of ALL bars (same warm-up) whose h-bar forward return is negative.
      let baseDown = 0;
      let baseN = 0;
      for (const [, ctx] of ctxMap) {
        const c = ctx.closes;
        for (let i = 205; i + h < c.length; i++) {
          baseN++;
          if (c[i + h] < c[i]) baseDown++;
        }
      }
      const baseRate = baseN > 0 ? (baseDown / baseN) * 100 : 0;
      const r = measureSellAccuracy(sellSignals, priceData, h);
      console.log(
        `${`${h}d`.padEnd(8)} | ${`${r.accuracy.toFixed(1)}%`.padStart(8)} | ${`${baseRate.toFixed(1)}%`.padStart(8)} | ${`${(r.accuracy - baseRate).toFixed(1)}pp`.padStart(7)} | ${`${r.avgRet.toFixed(2)}%`.padStart(7)} | ${r.rewardRisk.toFixed(2).padStart(5)} | ${String(r.total).padStart(5)}`
      );
    }
    console.log('  By entry year (5d):');
    for (const yr of ENTRY_YEARS) {
      const sub = sellSignals.filter((s) => s.date.toISOString().slice(0, 4) === yr);
      if (sub.length === 0) continue;
      const r = measureSellAccuracy(sub, priceData, 5);
      console.log(
        `    ${yr}: accuracy=${r.accuracy.toFixed(1)}%  avgRet=${r.avgRet.toFixed(2)}%  R/R=${r.rewardRisk.toFixed(2)}  N=${r.total}`
      );
    }
    console.log('  By trend regime (5d):');
    for (const regime of ['uptrend', 'downtrend', 'sideways']) {
      const sub = sellSignals.filter((s) => s.regime === regime);
      if (sub.length === 0) continue;
      const r = measureSellAccuracy(sub, priceData, 5);
      console.log(
        `    ${regime.padEnd(9)}: accuracy=${r.accuracy.toFixed(1)}%  avgRet=${r.avgRet.toFixed(2)}%  R/R=${r.rewardRisk.toFixed(2)}  N=${r.total}`
      );
    }
    // Which component actually carries information? (SELL path has no gate
    // feedback, so post-hoc subsetting of fired SELLs is valid here.)
    console.log('  By driver subset (5d):');
    const sellSubsets: { name: string; f: (s: BacktestSignal) => boolean }[] = [
      { name: 'distribution vwap<.3+volR≥1.5', f: (s) => s.vwap < 0.3 && s.volumeRatio >= 1.5 },
      { name: 'overbought rsi≥75', f: (s) => s.rsi >= 75 },
      { name: 'not-overbought rsi<75', f: (s) => s.rsi < 75 },
      { name: 'rsi<75 + downtrend', f: (s) => s.rsi < 75 && s.regime === 'downtrend' },
      { name: 'rsi<75 + volR≥1.5', f: (s) => s.rsi < 75 && s.volumeRatio >= 1.5 },
      {
        name: 'distrib + downtrend',
        f: (s) => s.vwap < 0.3 && s.volumeRatio >= 1.5 && s.regime === 'downtrend',
      },
      { name: 'weak RS (rsSpy<.3 & rsSector<.3)', f: (s) => s.rsSpy < 0.3 && s.rsSector < 0.3 },
      {
        name: 'weak RS + distribution',
        f: (s) => s.rsSpy < 0.3 && s.rsSector < 0.3 && s.vwap < 0.3 && s.volumeRatio >= 1.5,
      },
    ];
    for (const sub of sellSubsets) {
      const rows = sellSignals.filter(sub.f);
      if (rows.length === 0) {
        console.log(`    ${sub.name.padEnd(32)}: N=0`);
        continue;
      }
      const r = measureSellAccuracy(rows, priceData, 5);
      console.log(
        `    ${sub.name.padEnd(32)}: accuracy=${r.accuracy.toFixed(1)}%  avgRet=${r.avgRet.toFixed(2)}%  R/R=${r.rewardRisk.toFixed(2)}  N=${r.total}`
      );
    }
  }

  // Candidate replacement SELL trigger — essay #2's exit rule: the Gaussian
  // Channel flipping red. Measured directly on the precomputed series (the flip
  // bar is causal: series[i] uses closes[0..i] only).
  console.log('\n  Gaussian red-flip as SELL trigger (vs same base rates):');
  for (const h of [5, 10, 20]) {
    let hits = 0;
    let total = 0;
    let retSum = 0;
    let downSum = 0;
    let downCnt = 0;
    let upSum = 0;
    let upCnt = 0;
    let baseDown = 0;
    let baseN = 0;
    for (const [, ctx] of ctxMap) {
      const c = ctx.closes;
      const g = ctx.gaussianSeries;
      for (let i = 206; i + h < c.length; i++) {
        baseN++;
        if (c[i + h] < c[i]) baseDown++;
        const flippedRed = g[i].direction === 'down' && g[i - 1].direction !== 'down';
        if (!flippedRed) continue;
        const ret = ((c[i + h] - c[i]) / c[i]) * 100;
        total++;
        retSum += ret;
        if (ret < 0) {
          hits++;
          downSum += -ret;
          downCnt++;
        } else {
          upSum += ret;
          upCnt++;
        }
      }
    }
    const baseRate = baseN > 0 ? (baseDown / baseN) * 100 : 0;
    const acc = total > 0 ? (hits / total) * 100 : 0;
    const avgDown = downCnt > 0 ? downSum / downCnt : 0;
    const avgUp = upCnt > 0 ? upSum / upCnt : 0;
    console.log(
      `    ${`${h}d`.padEnd(4)}: accuracy=${acc.toFixed(1)}%  base=${baseRate.toFixed(1)}%  edge=${(acc - baseRate).toFixed(1)}pp  avgRet=${total > 0 ? (retSum / total).toFixed(2) : '0'}%  R/R=${avgUp > 0 ? (avgDown / avgUp).toFixed(2) : '0'}  N=${total}`
    );
  }

  console.log('\nDelta (V6 trend-hold - V5 fixed-5d):');
  console.log(`  Win rate:    ${(v6Result.winRate5d - v5Result.winRate5d).toFixed(1)}pp`);
  console.log(`  Avg return:  ${(v6Result.avgReturn - v5Result.avgReturn).toFixed(2)}pp`);
  console.log(`  R/R ratio:   ${(v6Result.rewardRisk - v5Result.rewardRisk).toFixed(2)}`);

  // Per-bar normalized return — apples-to-apples vs the fixed 5-day horizon.
  const v5PerBar = v5Result.avgReturn / v5Result.avgHoldBars;
  const v6PerBar = v6Result.avgHoldBars > 0 ? v6Result.avgReturn / v6Result.avgHoldBars : 0;
  console.log('\nPer-bar return (normalized for holding period):');
  console.log(`  V5 (hold ${v5Result.avgHoldBars.toFixed(1)} bars): ${v5PerBar.toFixed(3)}%/bar`);
  console.log(`  V6 (hold ${v6Result.avgHoldBars.toFixed(1)} bars): ${v6PerBar.toFixed(3)}%/bar`);

  // Robustness — is V6's edge regime-dependent (only the 2023-26 bull)? Split by entry year.
  console.log('\nV6 trend-hold robustness by entry year:');
  console.log(
    `${'Year'.padEnd(6)} | ${'Signals'.padStart(7)} | ${'WinRate'.padStart(7)} | ${'AvgRet'.padStart(7)} | ${'PerBar'.padStart(7)} | ${'R/R'.padStart(5)} | ${'Hold'.padStart(5)}`
  );
  for (const yr of ENTRY_YEARS) {
    const sub = v5Signals.filter((s) => s.date.toISOString().slice(0, 4) === yr);
    if (sub.length === 0) continue;
    const r = measureTrendHoldWinRate(sub, priceData, { costPct: COST_PCT });
    const pb = r.avgHoldBars > 0 ? r.avgReturn / r.avgHoldBars : 0;
    console.log(
      `${yr.padEnd(6)} | ${String(r.totalSignals).padStart(7)} | ${`${r.winRate5d.toFixed(1)}%`.padStart(7)} | ${`${r.avgReturn.toFixed(2)}%`.padStart(7)} | ${`${pb.toFixed(3)}%`.padStart(7)} | ${r.rewardRisk.toFixed(2).padStart(5)} | ${r.avgHoldBars.toFixed(1).padStart(5)}`
    );
  }

  // Exit-rule comparison on the SAME V5 entries — optimize the exit (where the edge is).
  console.log('\nExit-rule comparison (V5 entries):');
  console.log(
    `${'Exit rule'.padEnd(20)} | ${'WinRate'.padStart(7)} | ${'AvgRet'.padStart(7)} | ${'PerBar'.padStart(7)} | ${'R/R'.padStart(5)} | ${'Hold'.padStart(5)}`
  );
  const exitVariants: {
    name: string;
    opts: { exitRule?: 'flip' | 'mid'; stopPct?: number; trailPct?: number };
  }[] = [
    { name: 'flip + stop8 (V6)', opts: { exitRule: 'flip', stopPct: 8 } },
    { name: 'flip + stop5', opts: { exitRule: 'flip', stopPct: 5 } },
    { name: 'flip + stop12', opts: { exitRule: 'flip', stopPct: 12 } },
    { name: 'mid-cross + stop8', opts: { exitRule: 'mid', stopPct: 8 } },
    { name: 'flip + trail10', opts: { exitRule: 'flip', stopPct: 8, trailPct: 10 } },
    { name: 'flip + trail15', opts: { exitRule: 'flip', stopPct: 8, trailPct: 15 } },
  ];
  for (const v of exitVariants) {
    const r = measureTrendHoldWinRate(v5Signals, priceData, { ...v.opts, costPct: COST_PCT });
    const pb = r.avgHoldBars > 0 ? r.avgReturn / r.avgHoldBars : 0;
    console.log(
      `${v.name.padEnd(20)} | ${`${r.winRate5d.toFixed(1)}%`.padStart(7)} | ${`${r.avgReturn.toFixed(2)}%`.padStart(7)} | ${`${pb.toFixed(3)}%`.padStart(7)} | ${r.rewardRisk.toFixed(2).padStart(5)} | ${r.avgHoldBars.toFixed(1).padStart(5)}`
    );
  }

  console.log('\nDelta (V4 - V2 baseline):');
  console.log(`  Win rate:    ${(v4Result.winRate5d - v2Result.winRate5d).toFixed(1)}pp`);
  console.log(
    `  Signals:     ${v4Result.totalSignals - v2Result.totalSignals} (${v4Result.totalSignals > v2Result.totalSignals ? '+' : ''}${((v4Result.totalSignals / Math.max(v2Result.totalSignals, 1) - 1) * 100).toFixed(0)}%)`
  );
  console.log(`  Avg return:  ${(v4Result.avgReturn - v2Result.avgReturn).toFixed(2)}pp`);
  console.log(`  R/R ratio:   ${(v4Result.rewardRisk - v2Result.rewardRisk).toFixed(2)}`);
  console.log('\nDelta (V5 - V2 baseline):');
  console.log(`  Win rate:    ${(v5Result.winRate5d - v2Result.winRate5d).toFixed(1)}pp`);
  console.log(
    `  Signals:     ${v5Result.totalSignals - v2Result.totalSignals} (${v5Result.totalSignals > v2Result.totalSignals ? '+' : ''}${((v5Result.totalSignals / Math.max(v2Result.totalSignals, 1) - 1) * 100).toFixed(0)}%)`
  );
  console.log(`  Avg return:  ${(v5Result.avgReturn - v2Result.avgReturn).toFixed(2)}pp`);
  console.log(`  R/R ratio:   ${(v5Result.rewardRisk - v2Result.rewardRisk).toFixed(2)}`);

  // Phase 1: Diagnostic — analyze signals from V4 momentum config
  const baseConfig: PipelineConfig = {
    ...DEFAULT_PIPELINE_CONFIG,
    institutional: { ...DEFAULT_INSTITUTIONAL_CONFIG, enabled: false },
    patternWeights: Object.fromEntries(
      Object.keys(DEFAULT_PIPELINE_CONFIG.patternWeights).map((k) => [k, 0])
    ),
    trendGate: { ...DEFAULT_PIPELINE_CONFIG.trendGate, minConditions: 1, enabled: true },
    reversalConfirm: { ...DEFAULT_PIPELINE_CONFIG.reversalConfirm, enabled: false },
    confidenceGate: { ...DEFAULT_PIPELINE_CONFIG.confidenceGate, enabled: false },
  };

  console.log('\n📋 Phase 1: Diagnostic — All 20 signals detail');
  console.log('='.repeat(130));

  const diagSignals: (BacktestSignal & { ret5d: number; win: boolean })[] = [];

  for (const [ticker, ctx] of ctxMap) {
    const sigs = runSignalsWithContext(ctx, ticker, baseConfig);
    const prices = priceData.get(ticker)!;
    for (const sig of sigs) {
      if (sig.decision !== 'BUY') continue;
      const idx = prices.findIndex((p) => p.date.getTime() === sig.date.getTime());
      if (idx === -1 || idx + 5 >= prices.length) continue;
      const futurePrice = prices[idx + 5].close;
      const ret5d = ((futurePrice - sig.close) / sig.close) * 100 - COST_PCT;

      diagSignals.push({
        ...sig,
        ret5d,
        win: ret5d > 0,
      });
    }
  }

  diagSignals.sort((a, b) => a.date.getTime() - b.date.getTime());

  console.log(
    `${'Date'.padEnd(12)} ${'Ticker'.padEnd(6)} ${'Scr'.padStart(4)} ${'IBS'.padStart(5)} ${'R2c'.padStart(5)} ${'ATRd'.padStart(5)} ${'COs'.padStart(4)} ${'VolR'.padStart(5)} ${'Ret5d'.padStart(7)} ${'W'.padStart(2)}`
  );
  console.log('-'.repeat(65));
  for (const s of diagSignals) {
    const dateStr = s.date.toISOString().slice(0, 10);
    console.log(
      `${dateStr.padEnd(12)} ${s.ticker.padEnd(6)} ${s.score.toFixed(0).padStart(4)} ${s.ibs.toFixed(2).padStart(5)} ${s.rsi2cumul.toFixed(0).padStart(5)} ${s.atrDistance.toFixed(1).padStart(5)} ${String(s.consecutiveOversold).padStart(4)} ${s.volumeRatio.toFixed(1).padStart(5)} ${s.ret5d.toFixed(2).padStart(6)}% ${(s.win ? 'W' : 'L').padStart(2)}`
    );
  }

  const wins = diagSignals.filter((s) => s.win);
  const losses = diagSignals.filter((s) => !s.win);
  console.log(`\nWins: ${wins.length}, Losses: ${losses.length}`);
  if (losses.length > 0) {
    console.log('\n🔴 Failed signals analysis:');
    for (const s of losses) {
      console.log(
        `  ${s.date.toISOString().slice(0, 10)} ${s.ticker} close=${s.close.toFixed(2)} score=${s.score.toFixed(0)} ret=${s.ret5d.toFixed(2)}% regime=${s.regime} confR=${s.confluenceRatio.toFixed(2)}`
      );
    }
    console.log('\n🟢 Winning signals stats:');
    console.log(`  Avg score: ${(wins.reduce((a, s) => a + s.score, 0) / wins.length).toFixed(0)}`);
    console.log(
      `  Avg confR: ${(wins.reduce((a, s) => a + s.confluenceRatio, 0) / wins.length).toFixed(2)}`
    );
    console.log('\n🔴 Losing signals stats:');
    console.log(
      `  Avg score: ${(losses.reduce((a, s) => a + s.score, 0) / losses.length).toFixed(0)}`
    );
    console.log(
      `  Avg confR: ${(losses.reduce((a, s) => a + s.confluenceRatio, 0) / losses.length).toFixed(2)}`
    );
  }

  // Phase 2: New filter experiments based on diagnostic
  console.log('\n\n📋 Phase 2: Post-hoc filter experiments');
  console.log('='.repeat(130));

  // Apply post-hoc filters to the base signal set
  // Multi-period win rate analysis
  console.log('\n📊 Holding period analysis:');
  console.log('-'.repeat(70));
  for (const period of [1, 2, 3, 5, 7, 10, 15, 20]) {
    let wins = 0,
      total = 0;
    for (const sig of diagSignals) {
      if (sig.decision !== 'BUY') continue;
      const prices = priceData.get(sig.ticker);
      if (!prices) continue;
      const idx = prices.findIndex((p) => p.date.getTime() === sig.date.getTime());
      if (idx === -1 || idx + period >= prices.length) continue;
      total++;
      const ret = ((prices[idx + period].close - sig.close) / sig.close) * 100 - COST_PCT;
      if (ret > 0) wins++;
    }
    const wr = total > 0 ? ((wins / total) * 100).toFixed(1) : 'N/A';
    console.log(`  ${String(period).padStart(2)}d: ${wr}% (${wins}/${total})`);
  }

  // volR<1.5 subset multi-period
  console.log('\n📊 volR<1.5 holding period:');
  console.log('-'.repeat(70));
  const lowVol = diagSignals.filter((s) => s.decision === 'BUY' && s.volumeRatio < 1.5);
  for (const period of [1, 2, 3, 5, 7, 10, 15, 20]) {
    let wins = 0,
      total = 0;
    for (const sig of lowVol) {
      const prices = priceData.get(sig.ticker);
      if (!prices) continue;
      const idx = prices.findIndex((p) => p.date.getTime() === sig.date.getTime());
      if (idx === -1 || idx + period >= prices.length) continue;
      total++;
      const ret = ((prices[idx + period].close - sig.close) / sig.close) * 100 - COST_PCT;
      if (ret > 0) wins++;
    }
    const wr = total > 0 ? ((wins / total) * 100).toFixed(1) : 'N/A';
    console.log(`  ${String(period).padStart(2)}d: ${wr}% (${wins}/${total})`);
  }

  console.log(
    `${'Filter'.padEnd(35)} | ${'WinRate'.padStart(8)} | ${'Signals'.padStart(8)} | ${'Wins'.padStart(5)} | ${'Losses'.padStart(7)} | ${'AvgRet'.padStart(8)}`
  );
  console.log('-'.repeat(85));

  for (const { name, filter } of POST_FILTERS) {
    const filtered = diagSignals.filter((s) => filter(s, diagSignals));
    const w = filtered.filter((s) => s.win).length;
    const l = filtered.filter((s) => !s.win).length;
    const total = w + l;
    const wr = total > 0 ? `${((w / total) * 100).toFixed(1)}%` : 'N/A';
    const avg =
      filtered.length > 0
        ? `${(filtered.reduce((a, s) => a + s.ret5d, 0) / filtered.length).toFixed(2)}%`
        : 'N/A';
    console.log(
      `${name.padEnd(35)} | ${wr.padStart(8)} | ${String(total).padStart(8)} | ${String(w).padStart(5)} | ${String(l).padStart(7)} | ${avg.padStart(8)}`
    );
  }

  // Phase 3: Grid search with structural filters
  console.log('\n\n📋 Phase 3: Grid search');
  console.log('='.repeat(130));

  const configs: { name: string; config: PipelineConfig }[] = [];

  for (const threshold of [260, 280, 300, 320, 350]) {
    for (const gapDays of [3, 5, 7, 99]) {
      for (const confMin of [2, 3, 4]) {
        for (const rev of [true, false]) {
          const clusterEnabled = gapDays < 99;
          const cfg: PipelineConfig = {
            ...baseConfig,
            confluence: { ...baseConfig.confluence, minActive: confMin },
            thresholds: { buy: threshold, sell: 200 },
            clusterFilter: { enabled: clusterEnabled, minGapDays: clusterEnabled ? gapDays : 5 },
            reversalConfirm: { enabled: rev, volumeMultiplier: 1.0 },
          };
          const name = `Th=${threshold} G=${clusterEnabled ? `${gapDays}d` : 'off'} C≥${confMin} R=${rev ? 'Y' : 'N'}`;
          configs.push({ name, config: cfg });
        }
      }
    }
  }

  console.log(`Testing ${configs.length} configurations...\n`);
  console.log(
    `${'Config'.padEnd(35)} | ${'WinRate'.padStart(8)} | ${'Signals'.padStart(8)} | ${'AvgRet'.padStart(8)} | ${'R/R'.padStart(6)} | ${'Sig/Mo'.padStart(6)}`
  );
  console.log('-'.repeat(85));

  const results: { name: string; result: WinRateResult }[] = [];

  for (const { name, config } of configs) {
    const allSignals: BacktestSignal[] = [];
    for (const [ticker, ctx] of ctxMap) {
      allSignals.push(...runSignalsWithContext(ctx, ticker, config));
    }

    const result = measure5DayWinRate(allSignals, priceData, COST_PCT);
    results.push({ name, result });

    if (result.totalSignals >= 3) {
      const wr = `${result.winRate5d.toFixed(1)}%`;
      const sig = result.totalSignals.toString();
      const avg = `${result.avgReturn.toFixed(2)}%`;
      const rr = result.rewardRisk.toFixed(2);
      const spm = result.signalsPerMonth.toFixed(1);
      console.log(
        `${name.padEnd(35)} | ${wr.padStart(8)} | ${sig.padStart(8)} | ${avg.padStart(8)} | ${rr.padStart(6)} | ${spm.padStart(6)}`
      );
    }
  }

  // Find best config with ≥ 75% win rate and reasonable signal count
  console.log(`\n${'='.repeat(85)}`);
  console.log('🏆 Best configurations (win rate ≥ 60%, signals ≥ 3):');
  console.log('='.repeat(85));

  const qualifying = results
    .filter((r) => r.result.winRate5d >= 60 && r.result.totalSignals >= 5)
    .sort(
      (a, b) =>
        b.result.winRate5d - a.result.winRate5d || b.result.totalSignals - a.result.totalSignals
    );

  for (const { name, result } of qualifying.slice(0, 20)) {
    console.log(
      `  ${name.padEnd(35)} | WR=${result.winRate5d.toFixed(1)}% | N=${result.totalSignals} | AvgRet=${result.avgReturn.toFixed(2)}% | R/R=${result.rewardRisk.toFixed(2)}`
    );

    // Monthly breakdown for top configs
    if (result.winRate5d >= 70) {
      for (const [month, m] of Object.entries(result.monthlyBreakdown).sort()) {
        const mwr = m.total > 0 ? ((m.wins / m.total) * 100).toFixed(0) : 'N/A';
        console.log(`    ${month}: ${mwr}% (${m.wins}/${m.total})`);
      }
    }
  }

  if (qualifying.length === 0) {
    console.log('  No configurations achieved ≥ 60% win rate with ≥ 3 signals.');
    console.log('\n  All results with signals:');
    const withSignals = results
      .filter((r) => r.result.totalSignals > 0)
      .sort((a, b) => b.result.winRate5d - a.result.winRate5d);
    for (const { name, result } of withSignals.slice(0, 20)) {
      console.log(
        `  ${name.padEnd(35)} | WR=${result.winRate5d.toFixed(1)}% | N=${result.totalSignals} | AvgRet=${result.avgReturn.toFixed(2)}%`
      );
    }
  }

  // ==========================================================================
  // Phase 4: Goal search — entry filter reaching WR ≥ 60% AND R/R > baseline.
  //   Levers are essay-aligned quality/pullback features:
  //     IBS  = intraday close position (low = bought weakness, essay #2 눌림목)
  //     ATR% = volatility (lower = calmer names win more often)
  //     volR = participation, score band = signal strength, regime = trend gate
  //   Eval is O(N) over precomputed 5-day returns, so the FULL discrete grid is
  //   enumerated deterministically — no sampling variance, fully reproducible
  //   (cheaper and more honest than Bayesian search when each eval is O(N)).
  //   Discipline against overfit: the config is SELECTED on train (entries ≤
  //   2024) and must INDEPENDENTLY hold on holdout (entries ≥ 2025); per-year
  //   robustness is printed for the winner.
  // ==========================================================================
  console.log('\n\n📋 Phase 4: Goal search — WR ≥ 60% & R/R > baseline');
  console.log('='.repeat(130));

  const BASELINE_RR = v5Result.rewardRisk;
  const BASELINE_WR = v5Result.winRate5d;
  console.log(
    `Baseline (V5, fixed 5-day): WR=${BASELINE_WR.toFixed(1)}%  R/R=${BASELINE_RR.toFixed(2)}  N=${v5Result.totalSignals}`
  );
  console.log('Goal: WR ≥ 60.0%  AND  R/R > baseline, holding on BOTH train and holdout.\n');

  interface Enriched {
    ret5d: number;
    win: boolean; // ret5d > 0 (matches measure5DayWinRate)
    year: string;
    ibs: number;
    atrPct: number;
    volR: number;
    score: number;
    regime: string;
    sma50dist: number;
    rsSpy: number; // essay #1: relative strength vs market
    rsSector: number; // essay #1: relative strength vs sector
    vwap: number; // essay #1: accumulation above VWAP
    spyUp: boolean; // essay #2 at the index level: SPY Gaussian green
    sma200Above: boolean; // essay #1: pullback within a long-term uptrend
  }
  // SPY Gaussian regime by date (causal series) — the market kill-switch lever.
  const spyGaussSeries =
    spyData.length > 0 ? gaussianChannel(spyData.map((d) => d.close)).series : [];
  const spyUpByTime = new Map<number, boolean>();
  spyData.forEach((d, i) => {
    spyUpByTime.set(d.date.getTime(), spyGaussSeries[i].isGreen);
  });

  const enriched: Enriched[] = [];
  for (const sig of v5Signals) {
    if (sig.decision !== 'BUY') continue;
    const prices = priceData.get(sig.ticker);
    if (!prices) continue;
    const idx = prices.findIndex((p) => p.date.getTime() === sig.date.getTime());
    if (idx === -1 || idx + 5 >= prices.length) continue;
    const ret5d = ((prices[idx + 5].close - sig.close) / sig.close) * 100 - COST_PCT;
    enriched.push({
      ret5d,
      win: ret5d > 0,
      year: sig.date.toISOString().slice(0, 4),
      ibs: sig.ibs,
      atrPct: sig.close > 0 ? (sig.atr / sig.close) * 100 : 0,
      volR: sig.volumeRatio,
      score: sig.score,
      regime: sig.regime,
      sma50dist: sig.sma50dist,
      rsSpy: sig.rsSpy,
      rsSector: sig.rsSector,
      vwap: sig.vwap,
      spyUp: spyUpByTime.get(sig.date.getTime()) ?? true,
      sma200Above: sig.sma200dist > 0,
    });
  }
  const trainRows = enriched.filter((e) => e.year <= '2024');
  const testRows = enriched.filter((e) => e.year >= '2025');
  console.log(
    `Enriched BUY signals: ${enriched.length} (train ≤2024: ${trainRows.length}, holdout ≥2025: ${testRows.length})\n`
  );

  interface Filt {
    ibsMax: number;
    atrMax: number;
    volRMax: number;
    volRMin: number;
    scoreMin: number;
    scoreMax: number;
    regime: 'any' | 'uptrend' | 'notdown';
    sma50: 'any' | 'below' | 'above';
    rsMin: number; // essay #1: require strength vs BOTH market and sector
    vwapReq: boolean; // essay #1: require above-VWAP accumulation
    spyReq: boolean; // essay #2 index-level: SPY Gaussian green only
    sma200: 'any' | 'above'; // essay #1: long-term uptrend (stage) filter
  }
  const passes = (e: Enriched, f: Filt): boolean =>
    e.ibs < f.ibsMax &&
    e.atrPct < f.atrMax &&
    e.volR < f.volRMax &&
    e.volR > f.volRMin &&
    e.score >= f.scoreMin &&
    e.score < f.scoreMax &&
    e.rsSpy >= f.rsMin &&
    e.rsSector >= f.rsMin &&
    (!f.vwapReq || e.vwap >= 0.5) &&
    (!f.spyReq || e.spyUp) &&
    (f.sma200 === 'any' || e.sma200Above) &&
    (f.regime === 'any' ||
      (f.regime === 'uptrend' ? e.regime === 'uptrend' : e.regime !== 'downtrend')) &&
    (f.sma50 === 'any' || (f.sma50 === 'below' ? e.sma50dist < 0 : e.sma50dist > 0));

  interface Stat {
    n: number;
    wr: number;
    rr: number;
    avgRet: number;
    avgWin: number;
    avgLoss: number;
  }
  const statOf = (rows: Enriched[]): Stat => {
    const n = rows.length;
    if (n === 0) return { n: 0, wr: 0, rr: 0, avgRet: 0, avgWin: 0, avgLoss: 0 };
    let wins = 0;
    let winSum = 0;
    let winCnt = 0;
    let lossSum = 0;
    let lossCnt = 0;
    let retSum = 0;
    for (const r of rows) {
      retSum += r.ret5d;
      if (r.ret5d > 0) {
        wins++;
        winSum += r.ret5d;
        winCnt++;
      } else {
        lossSum += r.ret5d;
        lossCnt++;
      }
    }
    const avgWin = winCnt > 0 ? winSum / winCnt : 0;
    const avgLoss = lossCnt > 0 ? Math.abs(lossSum / lossCnt) : 0;
    return {
      n,
      wr: (wins / n) * 100,
      rr: avgLoss > 0 ? avgWin / avgLoss : 0,
      avgRet: retSum / n,
      avgWin,
      avgLoss,
    };
  };

  const ibsMaxes = [0.12, 0.15, 0.18, 0.2, 0.25, 0.3, 2];
  const atrMaxes = [2.5, 3, 3.5, 4, 99];
  const volRMaxes = [1.2, 1.5, 2, 99];
  const volRMins = [0, 0.8];
  const scoreMins = [0, 260, 300];
  const scoreMaxes = [380, 400, 9999];
  const regimeModes: Filt['regime'][] = ['any', 'uptrend', 'notdown'];
  const sma50Modes: Filt['sma50'][] = ['any', 'below', 'above'];
  const rsMins = [0, 0.5, 0.7]; // essay #1: relative-strength thresholds (gradient ∈ [0,1])
  const vwapReqs = [false, true];
  const spyReqs = [false, true]; // market kill-switch lever
  const sma200Modes: Filt['sma200'][] = ['any', 'above']; // stage filter lever

  const describe = (f: Filt): string =>
    [
      f.ibsMax < 2 ? `ibs<${f.ibsMax}` : null,
      f.atrMax < 99 ? `atr%<${f.atrMax}` : null,
      f.volRMax < 99 ? `volR<${f.volRMax}` : null,
      f.volRMin > 0 ? `volR>${f.volRMin}` : null,
      f.scoreMin > 0 ? `scr≥${f.scoreMin}` : null,
      f.scoreMax < 9999 ? `scr<${f.scoreMax}` : null,
      f.rsMin > 0 ? `rs≥${f.rsMin}` : null,
      f.vwapReq ? 'vwap+' : null,
      f.spyReq ? 'mktUp' : null,
      f.sma200 !== 'any' ? 'sma200above' : null,
      f.regime !== 'any' ? f.regime : null,
      f.sma50 !== 'any' ? `sma50${f.sma50}` : null,
    ]
      .filter(Boolean)
      .join(' ') || 'all';

  // Selection criteria — TRAIN must meet the goal with a non-trivial N; HOLDOUT
  // must independently confirm (slightly relaxed to allow normal sample noise).
  const MIN_TRAIN_N = 40;
  const MIN_TEST_N = 20;
  interface Cand {
    f: Filt;
    train: Stat;
    test: Stat;
    full: Stat;
  }
  // Filter-pushdown enumeration. The naive shape — re-scanning every row for
  // every config — is O(configs × rows) (~544k × 15k ≈ 8×10⁹ predicate evals).
  // Every dimension is a monotone threshold (or a fixed subset), so instead each
  // loop level narrows the SURVIVING row array once per value and passes it
  // down; the leaf computes stats on rows that already passed every earlier
  // dimension. Cost becomes O(Σ per-level subset sizes) — about 20-50× less
  // work — and the leaf needs no passes() call at all. `passAll` values (e.g.
  // ibs<2, atr<99) reuse the parent array without copying.
  const narrow = (rows: Enriched[], passAll: boolean, pred: (e: Enriched) => boolean) =>
    passAll ? rows : rows.filter(pred);

  const feasible: Cand[] = [];
  let evaluated = 0;
  for (const spyReq of spyReqs)
    for (const sma200 of sma200Modes) {
      const subPass = (e: Enriched) => (!spyReq || e.spyUp) && (sma200 === 'any' || e.sma200Above);
      const trainSub = trainRows.filter(subPass);
      const testSub = testRows.filter(subPass);
      const fullSub = enriched.filter(subPass);
      for (const ibsMax of ibsMaxes) {
        const r1 = narrow(trainSub, ibsMax >= 2, (e) => e.ibs < ibsMax);
        if (r1.length < MIN_TRAIN_N) continue; // prune: subsets only shrink below
        for (const atrMax of atrMaxes) {
          const r2 = narrow(r1, atrMax >= 99, (e) => e.atrPct < atrMax);
          if (r2.length < MIN_TRAIN_N) continue;
          for (const volRMax of volRMaxes) {
            const r3 = narrow(r2, volRMax >= 99, (e) => e.volR < volRMax);
            if (r3.length < MIN_TRAIN_N) continue;
            for (const volRMin of volRMins) {
              const r4 = narrow(r3, volRMin <= 0, (e) => e.volR > volRMin);
              if (r4.length < MIN_TRAIN_N) continue;
              for (const scoreMin of scoreMins) {
                const r5 = narrow(r4, scoreMin <= 0, (e) => e.score >= scoreMin);
                if (r5.length < MIN_TRAIN_N) continue;
                for (const scoreMax of scoreMaxes) {
                  if (scoreMin >= scoreMax) continue;
                  const r6 = narrow(r5, scoreMax >= 9999, (e) => e.score < scoreMax);
                  if (r6.length < MIN_TRAIN_N) continue;
                  for (const rsMin of rsMins) {
                    const r7 = narrow(
                      r6,
                      rsMin <= 0,
                      (e) => e.rsSpy >= rsMin && e.rsSector >= rsMin
                    );
                    if (r7.length < MIN_TRAIN_N) continue;
                    for (const vwapReq of vwapReqs) {
                      const r8 = narrow(r7, !vwapReq, (e) => e.vwap >= 0.5);
                      if (r8.length < MIN_TRAIN_N) continue;
                      for (const regime of regimeModes) {
                        const r9 = narrow(r8, regime === 'any', (e) =>
                          regime === 'uptrend' ? e.regime === 'uptrend' : e.regime !== 'downtrend'
                        );
                        if (r9.length < MIN_TRAIN_N) continue;
                        for (const sma50 of sma50Modes) {
                          const r10 = narrow(r9, sma50 === 'any', (e) =>
                            sma50 === 'below' ? e.sma50dist < 0 : e.sma50dist > 0
                          );
                          evaluated++;
                          // Early skip: a subset can only shrink down the tree.
                          if (r10.length < MIN_TRAIN_N) continue;
                          const tr = statOf(r10);
                          if (tr.wr < 60 || tr.rr <= BASELINE_RR) continue;
                          const f: Filt = {
                            ibsMax,
                            atrMax,
                            volRMax,
                            volRMin,
                            scoreMin,
                            scoreMax,
                            regime,
                            sma50,
                            rsMin,
                            vwapReq,
                            spyReq,
                            sma200,
                          };
                          const te = statOf(testSub.filter((e) => passes(e, f)));
                          const full = statOf(fullSub.filter((e) => passes(e, f)));
                          feasible.push({ f, train: tr, test: te, full });
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

  console.log(`Enumerated ${evaluated} filter configs deterministically.\n`);

  // Generalizing = holdout independently meets a (mildly relaxed) bar.
  const generalizes = (c: Cand): boolean =>
    c.test.n >= MIN_TEST_N && c.test.wr >= 58 && c.test.rr > 1.15;
  const ranked = feasible
    .filter(generalizes)
    .sort(
      (a, b) =>
        Math.min(b.train.wr, b.test.wr) - Math.min(a.train.wr, a.test.wr) ||
        b.full.rr - a.full.rr ||
        b.full.n - a.full.n
    );

  console.log(
    `Feasible on train (WR≥60 & R/R>${BASELINE_RR.toFixed(2)} & N≥${MIN_TRAIN_N}): ${feasible.length}`
  );
  console.log(`Of those, generalizing to holdout: ${ranked.length}\n`);

  const hdr = `${'Filter'.padEnd(46)} | ${'trWR'.padStart(5)} ${'trRR'.padStart(5)} ${'trN'.padStart(4)} | ${'teWR'.padStart(5)} ${'teRR'.padStart(5)} ${'teN'.padStart(4)} | ${'fullWR'.padStart(6)} ${'fullRR'.padStart(6)} ${'N'.padStart(4)}`;
  const rowOf = (c: Cand): string =>
    `${describe(c.f).padEnd(46)} | ${c.train.wr.toFixed(1).padStart(5)} ${c.train.rr.toFixed(2).padStart(5)} ${String(c.train.n).padStart(4)} | ${c.test.wr.toFixed(1).padStart(5)} ${c.test.rr.toFixed(2).padStart(5)} ${String(c.test.n).padStart(4)} | ${c.full.wr.toFixed(1).padStart(6)} ${c.full.rr.toFixed(2).padStart(6)} ${String(c.full.n).padStart(4)}`;

  if (ranked.length > 0) {
    console.log('🏆 Generalizing configs (train-selected, holdout-confirmed):');
    console.log(hdr);
    console.log('-'.repeat(hdr.length));
    for (const c of ranked.slice(0, 25)) console.log(rowOf(c));

    const best = ranked[0];
    console.log('\n✅ GOAL CANDIDATE (best generalizing):');
    console.log(`  Filter: ${describe(best.f)}`);
    console.log(
      `  TRAIN ≤2024 : WR=${best.train.wr.toFixed(1)}%  R/R=${best.train.rr.toFixed(2)}  N=${best.train.n}  avgRet=${best.train.avgRet.toFixed(2)}%`
    );
    console.log(
      `  HOLDOUT ≥2025: WR=${best.test.wr.toFixed(1)}%  R/R=${best.test.rr.toFixed(2)}  N=${best.test.n}  avgRet=${best.test.avgRet.toFixed(2)}%`
    );
    console.log(
      `  FULL        : WR=${best.full.wr.toFixed(1)}%  R/R=${best.full.rr.toFixed(2)}  N=${best.full.n}  avgRet=${best.full.avgRet.toFixed(2)}%`
    );
    console.log('  By entry year:');
    for (const yr of ENTRY_YEARS) {
      const ys = statOf(enriched.filter((e) => e.year === yr && passes(e, best.f)));
      if (ys.n === 0) continue;
      console.log(
        `    ${yr}: WR=${ys.wr.toFixed(1)}%  R/R=${ys.rr.toFixed(2)}  N=${ys.n}  avgRet=${ys.avgRet.toFixed(2)}%`
      );
    }
    const wrOk = best.full.wr >= 60 && best.full.rr > BASELINE_RR;
    console.log(
      `\n  ${wrOk ? '✅' : '⚠️'} Full-sample goal ${wrOk ? 'MET' : 'NOT fully met'}: WR ${best.full.wr.toFixed(1)}% (≥60), R/R ${best.full.rr.toFixed(2)} (>${BASELINE_RR.toFixed(2)})`
    );
  } else {
    console.log('⚠️ No train-selected config generalized to holdout under the goal bar.');
    console.log('   Closest feasible-on-train configs (may be overfit — holdout shown):');
    console.log(hdr);
    console.log('-'.repeat(hdr.length));
    for (const c of feasible
      .sort((a, b) => b.test.wr - a.test.wr || b.full.rr - a.full.rr)
      .slice(0, 20))
      console.log(rowOf(c));
  }

  // ==========================================================================
  // Dominance goal — beat V7 on BOTH axes at once, net of costs:
  //   WR ≥ 70% AND R/R ≥ V7's, independently on train AND holdout.
  // A higher WR bought by giving back R/R is a re-allocation, not an edge.
  // ==========================================================================
  const V7_RR = v7Result.rewardRisk;
  const dominant = feasible
    .filter(
      (c) =>
        c.test.n >= MIN_TEST_N &&
        c.train.wr >= 65 &&
        c.test.wr >= 65 &&
        c.train.rr >= V7_RR * 0.9 &&
        c.test.rr >= V7_RR * 0.9 &&
        c.full.wr >= 68 &&
        c.full.rr >= V7_RR
    )
    .sort(
      (a, b) =>
        Math.min(b.train.wr, b.test.wr) - Math.min(a.train.wr, a.test.wr) ||
        b.full.rr - a.full.rr ||
        b.full.n - a.full.n
    );

  console.log(
    `\n🥊 Dominance candidates — WR ≥ 68 full / ≥ 65 both splits AND R/R ≥ V7 (${V7_RR.toFixed(2)}):`
  );
  if (dominant.length === 0) {
    console.log('  None. The WR↑-without-R/R↓ region is empty in this lever space —');
    console.log('  the closest R/R-preserving configs are listed above; raising WR further');
    console.log('  currently buys win frequency by selling payoff size.');
  } else {
    console.log(hdr);
    console.log('-'.repeat(hdr.length));
    for (const c of dominant.slice(0, 15)) console.log(rowOf(c));
    const champ = dominant[0];
    console.log('\n👑 DOMINANCE CHAMPION:');
    console.log(`  Filter: ${describe(champ.f)}`);
    console.log(
      `  TRAIN ≤2024 : WR=${champ.train.wr.toFixed(1)}%  R/R=${champ.train.rr.toFixed(2)}  N=${champ.train.n}  avgRet=${champ.train.avgRet.toFixed(2)}%`
    );
    console.log(
      `  HOLDOUT ≥2025: WR=${champ.test.wr.toFixed(1)}%  R/R=${champ.test.rr.toFixed(2)}  N=${champ.test.n}  avgRet=${champ.test.avgRet.toFixed(2)}%`
    );
    console.log(
      `  FULL        : WR=${champ.full.wr.toFixed(1)}%  R/R=${champ.full.rr.toFixed(2)}  N=${champ.full.n}  avgRet=${champ.full.avgRet.toFixed(2)}%`
    );
    console.log('  By entry year:');
    for (const yr of ENTRY_YEARS) {
      const ys = statOf(enriched.filter((e) => e.year === yr && passes(e, champ.f)));
      if (ys.n === 0) continue;
      console.log(
        `    ${yr}: WR=${ys.wr.toFixed(1)}%  R/R=${ys.rr.toFixed(2)}  N=${ys.n}  avgRet=${ys.avgRet.toFixed(2)}%`
      );
    }
    const domGoalMet = champ.full.wr >= 70 && champ.full.rr >= V7_RR;
    console.log(
      `\n  ${domGoalMet ? '✅ DOMINANCE GOAL MET' : '⚠️ partial'}: WR ${champ.full.wr.toFixed(1)}% (target 70), R/R ${champ.full.rr.toFixed(2)} (floor ${V7_RR.toFixed(2)})`
    );
    console.log(
      '  NOTE: post-hoc numbers — wire the gate and re-validate through the real pipeline before believing them (hard-won rule #1).'
    );
  }
}
