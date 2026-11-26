// Cross-sectional feature scan on the frozen universe (weekly, non-overlapping).
//
// PROTOCOL (fixed before any result was read):
//   - Every fifth session t (from session 260), rank all liquid tickers by a feature computed
//     on data through t. Buy the top decile at the open of t+1, sell at the close of t+5,
//     10 bps round trip. Benchmark: all ranked tickers over the same window, same cost
//     (the universe itself, so the shared survivorship bias cancels), and SPY.
//   - Statistic: mean weekly excess of the top decile; interval by bootstrap over weeks
//     (2,000 resamples, seed 20261126).
//   - DEV = formation dates through 2023-12-31. TEST = 2024-01-01 onward, printed only for
//     --final=<feature>. One feature is chosen on DEV and run once on TEST.
import { COST, N, args, dates, mean, ok, liquid, series, spy, tickers, pct } from './harness.mjs';
import fs from 'node:fs';

const manifest = JSON.parse(
  fs.readFileSync('data/strategy-validation/leader-pullback-20261125-inputs/manifest.json', 'utf8')
);
const SPLIT = '2024-01-01';

function ret(s, t, k) {
  return ok(s.close[t - k]) && ok(s.close[t]) ? s.close[t] / s.close[t - k] - 1 : Number.NaN;
}
function stdev(s, t, k) {
  let sum = 0;
  let sq = 0;
  for (let i = t - k + 1; i <= t; i++) {
    const r = s.close[i] / s.close[i - 1] - 1;
    if (!Number.isFinite(r)) return Number.NaN;
    sum += r;
    sq += r * r;
  }
  return Math.sqrt(sq / k - (sum / k) ** 2);
}
// Higher value = bought.
const features = {
  'reversal-5d': (s, t) => -ret(s, t, 5),
  'reversal-21d': (s, t) => -ret(s, t, 21),
  'momentum-12-1': (s, t) =>
    ok(s.close[t - 252]) && ok(s.close[t - 21])
      ? s.close[t - 21] / s.close[t - 252] - 1
      : Number.NaN,
  'momentum-6-1': (s, t) =>
    ok(s.close[t - 126]) && ok(s.close[t - 21])
      ? s.close[t - 21] / s.close[t - 126] - 1
      : Number.NaN,
  'near-52w-high': (s, t) => {
    let high = 0;
    for (let i = t - 251; i <= t; i++) {
      if (!ok(s.close[i])) return Number.NaN;
      high = Math.max(high, s.close[i]);
    }
    return s.close[t] / high;
  },
  'low-volatility': (s, t) => -stdev(s, t, 60),
  'low-ibs': (s, t) =>
    s.high[t] > s.low[t] ? -(s.close[t] - s.low[t]) / (s.high[t] - s.low[t]) : Number.NaN,
  'below-sma50': (s, t) => -(s.close[t] / mean(s.close, t - 49, t) - 1),
  'volume-surge': (s, t) => mean(s.volume, t - 4, t) / mean(s.volume, t - 64, t - 5),
  'sector-strength-63d': (s, t, sector) => ret(s, t, 63) - ret(sector, t, 63),
  'low-max-21d': (s, t) => {
    let max = -Infinity;
    for (let i = t - 20; i <= t; i++) {
      const r = s.close[i] / s.close[i - 1] - 1;
      if (!Number.isFinite(r)) return Number.NaN;
      max = Math.max(max, r);
    }
    return -max;
  },
};

const sectorSeries = new Map();
function sectorOf(symbol) {
  const etf = manifest.universe[symbol];
  if (!sectorSeries.has(etf)) {
    const rows = JSON.parse(
      fs.readFileSync(
        `data/strategy-validation/leader-pullback-20261125-inputs/${etf}.json`,
        'utf8'
      )
    );
    const index = new Map(dates.map((d, i) => [d, i]));
    const close = new Float64Array(N).fill(Number.NaN);
    for (const b of rows) {
      const i = index.get(b.date.slice(0, 10));
      if (i !== undefined) close[i] = b.close;
    }
    sectorSeries.set(etf, { close });
  }
  return sectorSeries.get(etf);
}

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
function bootstrap(values) {
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

function weeks(id) {
  const out = [];
  for (let t = 260; t + 5 < N; t += 5) {
    const ranked = [];
    for (const symbol of tickers) {
      const s = series.get(symbol);
      if (!ok(s.close[t]) || !ok(s.open[t + 1]) || !ok(s.close[t + 5]) || !ok(s.close[t - 21]))
        continue;
      if (!liquid(s, t)) continue;
      const value = features[id](s, t, sectorOf(symbol));
      if (!Number.isFinite(value)) continue;
      ranked.push([value, s.close[t + 5] / s.open[t + 1] - 1 - COST]);
    }
    if (ranked.length < 100) continue;
    ranked.sort((a, b) => b[0] - a[0]);
    const k = Math.floor(ranked.length / 10);
    const top = avg(ranked.slice(0, k).map((r) => r[1]));
    const bottom = avg(ranked.slice(-k).map((r) => r[1]));
    const all = avg(ranked.map((r) => r[1]));
    const wins = ranked.slice(0, k).filter((r) => r[1] > 0).length / k;
    out.push({
      date: dates[t],
      top,
      bottom,
      all,
      wins,
      spy: spy.close[t + 5] / spy.open[t + 1] - 1 - COST,
      names: k,
    });
  }
  return out;
}
function line(label, rows) {
  const xAll = rows.map((r) => r.top - r.all);
  const xSpy = rows.map((r) => r.top - r.spy);
  const spread = rows.map((r) => r.top - r.bottom);
  const a = bootstrap(xAll);
  const b = bootstrap(xSpy);
  return [
    label.padEnd(26),
    `weeks ${rows.length}`,
    `top ${pct(avg(rows.map((r) => r.top)))}`,
    `univ ${pct(avg(rows.map((r) => r.all)))}`,
    `SPY ${pct(avg(rows.map((r) => r.spy)))}`,
    `win ${(avg(rows.map((r) => r.wins)) * 100).toFixed(1)}%`,
    `| x-univ ${pct(avg(xAll))} [${pct(a[0])}, ${pct(a[1])}]`,
    `| x-SPY ${pct(avg(xSpy))} [${pct(b[0])}, ${pct(b[1])}]`,
    `| top-bottom ${pct(avg(spread))}`,
    `| beats univ ${((xAll.filter((x) => x > 0).length / xAll.length) * 100).toFixed(0)}% of weeks`,
  ].join('  ');
}

for (const id of (args.features ?? Object.keys(features).join(',')).split(',')) {
  const rows = weeks(id);
  console.log(
    line(
      `${id} DEV`,
      rows.filter((r) => r.date < SPLIT)
    )
  );
  if (args.years) {
    for (const y of ['2019', '2020', '2021', '2022', '2023'])
      console.log(
        '   ',
        line(
          y,
          rows.filter((r) => r.date.startsWith(y))
        )
      );
  }
  if (args.final === id) {
    const test = rows.filter((r) => r.date >= SPLIT);
    console.log(line(`${id} TEST`, test));
    for (const y of ['2024', '2025', '2026'])
      console.log(
        '   ',
        line(
          y,
          test.filter((r) => r.date.startsWith(y))
        )
      );
  }
}
