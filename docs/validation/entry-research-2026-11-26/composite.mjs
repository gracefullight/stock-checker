// Leader pullback as a weekly cross-sectional rank (the product's thesis without the gate).
//
// REGISTERED before any result of this script was read:
//   - Every fifth session t (from session 260), among liquid tickers with both inputs:
//       leader   = percentile rank of the return from t-252 to t-21 (higher is better)
//       pullback = percentile rank of minus the five-session return (bigger drop is better)
//       score    = (leader + pullback) / 2, equal weights, no other input.
//     Buy the top decile at the open of t+1, sell at the close of t+5, 10 bps round trip.
//   - Benchmarks over the same window and cost: all ranked tickers, and SPY.
//   - Interval: bootstrap over weeks (2,000 resamples, seed 20261126).
//   - DEV = formation dates through 2023-12-31. TEST = 2024-01-01 onward, printed only
//     with --final, and only if DEV passes.
//   - Pass on a period: mean weekly excess over the universe AND over SPY both have a
//     95% interval above zero.
//   - Known limit, stated in advance: the universe is today's ticker list. Both inputs are
//     flattered by it, so a pass here is a candidate for the forward ledger, not proof.
import { COST, N, dates, liquid, ok, pct, series, spy, tickers } from './harness.mjs';

const SPLIT = '2024-01-01';
const final = process.argv.includes('--final');
const top = Number(process.argv.find((a) => a.startsWith('--top='))?.split('=')[1] ?? 0);

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function interval(values) {
  const random = rng(20261126);
  const means = [];
  for (let r = 0; r < 2000; r++) {
    let sum = 0;
    for (let k = 0; k < values.length; k++) sum += values[Math.floor(random() * values.length)];
    means.push(sum / values.length);
  }
  means.sort((a, b) => a - b);
  return [means[49], means[1949]];
}
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
function percentile(rows, key) {
  const order = [...rows].sort((a, b) => a[key] - b[key]);
  order.forEach((row, index) => {
    row[`${key}Rank`] = order.length > 1 ? index / (order.length - 1) : 0.5;
  });
}

const weeks = [];
for (let t = 260; t + 5 < N; t += 5) {
  const rows = [];
  for (const symbol of tickers) {
    const s = series.get(symbol);
    if (!ok(s.close[t - 252]) || !ok(s.close[t - 21]) || !ok(s.close[t - 5]) || !ok(s.close[t]))
      continue;
    if (!ok(s.open[t + 1]) || !ok(s.close[t + 5]) || !liquid(s, t)) continue;
    rows.push({
      symbol,
      leader: s.close[t - 21] / s.close[t - 252] - 1,
      pullback: -(s.close[t] / s.close[t - 5] - 1),
      net: s.close[t + 5] / s.open[t + 1] - 1 - COST,
    });
  }
  if (rows.length < 100) continue;
  percentile(rows, 'leader');
  percentile(rows, 'pullback');
  for (const row of rows) row.score = (row.leaderRank + row.pullbackRank) / 2;
  rows.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
  const count = top || Math.floor(rows.length / 10);
  const picked = rows.slice(0, count);
  weeks.push({
    date: dates[t],
    names: count,
    pick: avg(picked.map((r) => r.net)),
    wins: picked.filter((r) => r.net > 0).length / count,
    universe: avg(rows.map((r) => r.net)),
    spy: spy.close[t + 5] / spy.open[t + 1] - 1 - COST,
  });
}

function report(label, rows) {
  const overUniverse = rows.map((r) => r.pick - r.universe);
  const overSpy = rows.map((r) => r.pick - r.spy);
  const a = interval(overUniverse);
  const b = interval(overSpy);
  const compound = (f) =>
    (rows.reduce((x, r) => x * (1 + f(r)), 1) ** (52 / rows.length) - 1) * 100;
  console.log(
    [
      label.padEnd(10),
      `weeks ${rows.length}`,
      `names ${avg(rows.map((r) => r.names)).toFixed(0)}`,
      `pick ${pct(avg(rows.map((r) => r.pick)))}`,
      `universe ${pct(avg(rows.map((r) => r.universe)))}`,
      `SPY ${pct(avg(rows.map((r) => r.spy)))}`,
      `win ${(avg(rows.map((r) => r.wins)) * 100).toFixed(1)}%`,
      `(SPY weeks up ${((rows.filter((r) => r.spy > 0).length / rows.length) * 100).toFixed(1)}%)`,
      `| over universe ${pct(avg(overUniverse))} [${pct(a[0])}, ${pct(a[1])}]`,
      `| over SPY ${pct(avg(overSpy))} [${pct(b[0])}, ${pct(b[1])}]`,
      `| beats SPY ${((overSpy.filter((x) => x > 0).length / rows.length) * 100).toFixed(0)}% of weeks`,
      `| a year: pick ${compound((r) => r.pick).toFixed(1)}% SPY ${compound((r) => r.spy).toFixed(1)}%`,
    ].join('  ')
  );
}

const dev = weeks.filter((w) => w.date < SPLIT);
report('DEV', dev);
for (const year of ['2019', '2020', '2021', '2022', '2023'])
  report(
    `  ${year}`,
    dev.filter((w) => w.date.startsWith(year))
  );
if (final) {
  const test = weeks.filter((w) => w.date >= SPLIT);
  report('TEST', test);
  for (const year of ['2024', '2025', '2026'])
    report(
      `  ${year}`,
      test.filter((w) => w.date.startsWith(year))
    );
}
