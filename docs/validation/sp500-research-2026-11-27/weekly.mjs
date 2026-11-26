// Weekly cross-sectional rules on point-in-time S&P 500 membership, delisted names included.
//
// REGISTERED on 2026-11-27 before any return from this dataset was read:
//   - Universe at formation session t: tickers in the S&P 500 on that date (fja05680/sp500
//     historical components) that have adjusted bars at t-252, t-21, t-5, t and an open at
//     t+1. Bars come from Yahoo for tickers it still serves and from Tiingo for delisted
//     ones; per ticker, the source with more bars inside its membership span is used.
//     A member listed under a symbol that was later renamed is priced from the current
//     symbol (renames.mjs). Members without such bars are counted and reported as missing.
//   - Every fifth session, buy the top decile at the open of t+1 and sell at the close of
//     t+5; 10 bps round trip. A position whose series ends inside the hold (acquisition,
//     delisting) is sold at its last close; with no bar after the entry it returns -cost.
//   - Three rules, no others:
//       momentum-12-1     return from t-252 to t-21, highest
//       reversal-5d       five-session return, lowest
//       leader-pullback   mean of the two percentile ranks above (equal weights)
//   - Benchmarks, same window and cost: SPY, and all eligible members in equal weight.
//   - Interval: bootstrap over weeks, 2,000 resamples, seed 20261127.
//   - DEV = formation dates 2006-01-01 .. 2015-12-31. TEST = 2016-01-01 onward.
//     TEST is printed only with --final=<rule>, for a rule that passed DEV.
//   - Pass on a period: mean weekly excess over SPY and over the equal-weight members
//     both have a 95% interval above zero.
//   - Robustness, reported beside it and required to agree in sign: the same excess with
//     every position's weekly return clamped to +/-50%, so that one bad adjustment or one
//     takeover cannot carry a result.
import { bestBars, dates, memberDays, membersBySession, spyRows } from './data.mjs';

const COST = 0.001;
const DEV_FROM = '2006-01-01';
const SPLIT = '2016-01-01';
const finalRule = process.argv.find((a) => a.startsWith('--final='))?.split('=')[1];
const coverageOnly = process.argv.includes('--coverage');

const at = new Map(dates.map((d, i) => [d, i]));
const N = dates.length;
function align(rows) {
  const open = new Float64Array(N).fill(Number.NaN);
  const high = new Float64Array(N).fill(Number.NaN);
  const low = new Float64Array(N).fill(Number.NaN);
  const close = new Float64Array(N).fill(Number.NaN);
  let last = -1;
  for (const [date, o, h, l, c] of rows) {
    const i = at.get(date);
    if (i === undefined) continue;
    open[i] = o;
    high[i] = h;
    low[i] = l;
    close[i] = c;
    last = Math.max(last, i);
  }
  return { open, high, low, close, last };
}
const spy = align(spyRows);

// Each ticker is priced by whichever symbol and source covers most of its member-days.
const allDays = memberDays();
const sourceUse = { tiingo: 0, yahoo: 0, renamed: 0, none: 0 };
const cache = new Map();
function seriesOf(symbol) {
  if (!cache.has(symbol)) {
    const best = bestBars(symbol, allDays.get(symbol) ?? []);
    if (!best) sourceUse.none++;
    else if (best.symbol !== symbol) sourceUse.renamed++;
    else sourceUse[best.source]++;
    cache.set(symbol, best ? align(best.rows) : null);
  }
  return cache.get(symbol);
}

const ok = (x) => Number.isFinite(x) && x > 0;
function settle(s, t) {
  // Entry at the open of t+1; exit at the close of t+5 or the last close before it.
  for (let j = t + 5; j >= t + 1; j--)
    if (ok(s.close[j])) return s.close[j] / s.open[t + 1] - 1 - COST;
  return -COST;
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
function interval(values) {
  const random = rng(20261127);
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
const clamp = (x) => Math.max(-0.5, Math.min(0.5, x));
const pct = (x, d = 2) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}%`;
function rank(rows, key) {
  const order = [...rows].sort((a, b) => a[key] - b[key]);
  order.forEach((row, index) => {
    row[`${key}Rank`] = index / (order.length - 1);
  });
}

const memberLists = membersBySession(dates);
const RULES = ['momentum-12-1', 'reversal-5d', 'leader-pullback'];
const weeks = [];
const coverage = new Map();
const first = dates.findIndex((d) => d >= DEV_FROM);
for (let t = Math.max(first, 260); t + 5 < N; t += 5) {
  const members = memberLists[t];
  const rows = [];
  for (const symbol of members) {
    const s = seriesOf(symbol);
    if (
      !s ||
      !ok(s.close[t - 252]) ||
      !ok(s.close[t - 21]) ||
      !ok(s.close[t - 5]) ||
      !ok(s.close[t])
    )
      continue;
    if (!ok(s.open[t + 1])) continue;
    rows.push({
      symbol,
      momentum: s.close[t - 21] / s.close[t - 252] - 1,
      pullback: -(s.close[t] / s.close[t - 5] - 1),
      net: settle(s, t),
    });
  }
  const year = dates[t].slice(0, 4);
  const c = coverage.get(year) ?? { members: 0, priced: 0, weeks: 0 };
  c.members += members.length;
  c.priced += rows.length;
  c.weeks++;
  coverage.set(year, c);
  if (rows.length < 200) continue;
  rank(rows, 'momentum');
  rank(rows, 'pullback');
  for (const row of rows) row.blend = (row.momentumRank + row.pullbackRank) / 2;
  const count = Math.floor(rows.length / 10);
  const pick = (key) => {
    const chosen = [...rows]
      .sort((a, b) => b[key] - a[key] || a.symbol.localeCompare(b.symbol))
      .slice(0, count);
    return {
      net: avg(chosen.map((r) => r.net)),
      clamped: avg(chosen.map((r) => clamp(r.net))),
      wins: chosen.filter((r) => r.net > 0).length / count,
    };
  };
  weeks.push({
    date: dates[t],
    universe: avg(rows.map((r) => r.net)),
    universeClamped: avg(rows.map((r) => clamp(r.net))),
    spy: spy.close[t + 5] / spy.open[t + 1] - 1 - COST,
    'momentum-12-1': pick('momentum'),
    'reversal-5d': pick('pullback'),
    'leader-pullback': pick('blend'),
  });
}

console.log('coverage: members priced / members listed, by formation year');
console.log(
  [...coverage]
    .map(
      ([year, c]) =>
        `${year} ${((c.priced / c.members) * 100).toFixed(0)}% (${(c.priced / c.weeks).toFixed(0)}/${(c.members / c.weeks).toFixed(0)})`
    )
    .join('  ')
);
console.log(
  `tickers priced from Yahoo ${sourceUse.yahoo}, Tiingo ${sourceUse.tiingo}, a renamed symbol ${sourceUse.renamed}; never priced ${sourceUse.none}`
);
if (coverageOnly) process.exit(0);

function report(label, rule, rows) {
  const overSpy = rows.map((r) => r[rule].net - r.spy);
  const overUniverse = rows.map((r) => r[rule].net - r.universe);
  const a = interval(overSpy);
  const b = interval(overUniverse);
  const yearly = (f) =>
    (rows.reduce((x, r) => x * (1 + f(r)), 1) ** (50.4 / rows.length) - 1) * 100;
  console.log(
    [
      label.padEnd(24),
      `weeks ${rows.length}`,
      `pick ${pct(avg(rows.map((r) => r[rule].net)))}`,
      `members ${pct(avg(rows.map((r) => r.universe)))}`,
      `SPY ${pct(avg(rows.map((r) => r.spy)))}`,
      `win ${(avg(rows.map((r) => r[rule].wins)) * 100).toFixed(1)}%`,
      `| over SPY ${pct(avg(overSpy))} [${pct(a[0])}, ${pct(a[1])}]`,
      `| over members ${pct(avg(overUniverse))} [${pct(b[0])}, ${pct(b[1])}]`,
      `| clamped: over SPY ${pct(avg(rows.map((r) => r[rule].clamped - r.spy)))}, over members ${pct(avg(rows.map((r) => r[rule].clamped - r.universeClamped)))}`,
      `| beats SPY ${((overSpy.filter((x) => x > 0).length / rows.length) * 100).toFixed(0)}% of weeks`,
      `| a year: pick ${yearly((r) => r[rule].net).toFixed(1)}% members ${yearly((r) => r.universe).toFixed(1)}% SPY ${yearly((r) => r.spy).toFixed(1)}%`,
    ].join('  ')
  );
}
const dev = weeks.filter((w) => w.date < SPLIT);
const test = weeks.filter((w) => w.date >= SPLIT);
for (const rule of RULES) {
  report(`${rule} DEV`, rule, dev);
  if (finalRule === rule) {
    report(`${rule} TEST`, rule, test);
    for (const [a, b] of [
      ['2016', '2019'],
      ['2020', '2022'],
      ['2023', '2026'],
    ])
      report(
        `  ${a}-${b}`,
        rule,
        test.filter((w) => w.date.slice(0, 4) >= a && w.date.slice(0, 4) <= b)
      );
  }
}
