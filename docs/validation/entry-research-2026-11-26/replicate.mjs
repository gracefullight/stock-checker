// Replication of the DEV-selected index rule on a fixed ETF set.
//
// REGISTERED before any result of this script was read:
//   - Rule, unchanged: three consecutive lower closes on session t; enter the open of t+1;
//     leave at the open after the first close above the previous session's high, otherwise
//     at the tenth close; 10 bps round trip; one position per instrument.
//   - Instruments: SPY, QQQ, DIA, IWM, MDY and the nine original Select Sector SPDRs
//     (XLB XLE XLF XLI XLK XLP XLU XLV XLY). All listed before 2001; none delisted.
//   - Timing benchmark: the same exit applied from the open of every session of the same
//     instrument in the same period ("any day"). Edge = trade net - that instrument's
//     any-day mean. Win-rate edge = win - any-day win rate.
//   - Pooled statistic over all instruments; interval from a bootstrap over entry months
//     (all instruments' trades of a month move together), 2,000 resamples, seed 20261126.
//   - DEV = entries through 2012-12-31 (already seen for SPY and QQQ).
//     TEST = entries from 2013-01-01. Pass: pooled TEST edge interval above zero.
//   - Also reported: excess over SPY across the same window (the product's benchmark).
import fs from 'node:fs';

const DIR = `${process.env.INDEX_DATA ?? 'data/strategy-validation/index-etfs-20261126'}/`;
const COST = 0.001;
const SPLIT = '2013-01-01';
const SYMBOLS = [
  'SPY',
  'QQQ',
  'DIA',
  'IWM',
  'MDY',
  'XLB',
  'XLE',
  'XLF',
  'XLI',
  'XLK',
  'XLP',
  'XLU',
  'XLV',
  'XLY',
];
const variant = process.argv[2] ?? 'down3';

function load(symbol) {
  const rows = JSON.parse(fs.readFileSync(`${DIR}${symbol}.json`, 'utf8'));
  const s = { symbol, date: [], open: [], high: [], low: [], close: [], index: new Map() };
  for (const b of rows) {
    s.index.set(String(b.date).slice(0, 10), s.date.length);
    s.date.push(String(b.date).slice(0, 10));
    s.open.push(b.open);
    s.high.push(b.high);
    s.low.push(b.low);
    s.close.push(b.close);
  }
  return s;
}
const signals = {
  down3: (s, t) =>
    t >= 3 &&
    s.close[t] < s.close[t - 1] &&
    s.close[t - 1] < s.close[t - 2] &&
    s.close[t - 2] < s.close[t - 3],
};
function exitFrom(s, i) {
  const n = s.close.length;
  for (let k = i; k < i + 9; k++) {
    if (k + 1 >= n) return null;
    if (s.close[k] > s.high[k - 1]) return { j: k + 1, price: s.open[k + 1], atOpen: true };
  }
  if (i + 9 >= n) return null;
  return { j: i + 9, price: s.close[i + 9], atOpen: false };
}
function tradeAt(s, i, spy) {
  const out = exitFrom(s, i);
  if (!out) return null;
  const a = spy.index.get(s.date[i]);
  const b = spy.index.get(s.date[out.j]);
  const spyPrice = out.atOpen ? spy.open[b] : spy.close[b];
  return {
    symbol: s.symbol,
    entry: s.date[i],
    j: out.j,
    atOpen: out.atOpen,
    net: out.price / s.open[i] - 1 - COST,
    spyNet: a === undefined || b === undefined ? Number.NaN : spyPrice / spy.open[a] - 1 - COST,
  };
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
function interval(trades, value) {
  const groups = new Map();
  for (const t of trades) {
    const v = value(t);
    if (!Number.isFinite(v)) continue;
    const g = groups.get(t.entry.slice(0, 7)) ?? { sum: 0, n: 0 };
    g.sum += v;
    g.n++;
    groups.set(t.entry.slice(0, 7), g);
  }
  const list = [...groups.values()];
  const total = list.reduce((a, g) => a + g.sum, 0) / list.reduce((a, g) => a + g.n, 0);
  const random = rng(20261126);
  const means = [];
  for (let r = 0; r < 2000; r++) {
    let sum = 0;
    let n = 0;
    for (let k = 0; k < list.length; k++) {
      const g = list[Math.floor(random() * list.length)];
      sum += g.sum;
      n += g.n;
    }
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  return { mean: total, low: means[49], high: means[1949] };
}
const pct = (x, d = 2) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}%`;
const show = (ci) => `${pct(ci.mean)} [${pct(ci.low)}, ${pct(ci.high)}]`;

const spy = load('SPY');
const pooled = { DEV: [], TEST: [] };
const rows = [];
for (const symbol of SYMBOLS) {
  const s = symbol === 'SPY' ? spy : load(symbol);
  const n = s.close.length;
  const anyDay = { DEV: { sum: 0, wins: 0, n: 0 }, TEST: { sum: 0, wins: 0, n: 0 } };
  for (let i = 200; i < n; i++) {
    const t = tradeAt(s, i, spy);
    if (!t) continue;
    const a = anyDay[t.entry < SPLIT ? 'DEV' : 'TEST'];
    a.sum += t.net;
    a.n++;
    if (t.net > 0) a.wins++;
  }
  let busyUntil = -1;
  const mine = { DEV: [], TEST: [] };
  for (let t = 200; t < n - 1; t++) {
    if (t + 1 <= busyUntil) continue;
    if (!signals[variant](s, t)) continue;
    const trade = tradeAt(s, t + 1, spy);
    if (!trade) continue;
    busyUntil = trade.atOpen ? trade.j - 1 : trade.j;
    const period = trade.entry < SPLIT ? 'DEV' : 'TEST';
    trade.edge = trade.net - anyDay[period].sum / anyDay[period].n;
    trade.winEdge = (trade.net > 0 ? 1 : 0) - anyDay[period].wins / anyDay[period].n;
    trade.win = trade.net > 0 ? 1 : 0;
    mine[period].push(trade);
    pooled[period].push(trade);
  }
  rows.push({ symbol, mine, anyDay });
}

for (const period of ['DEV', 'TEST']) {
  console.log(
    `\n== ${period} (${period === 'DEV' ? 'entries through 2012' : 'entries from 2013'})`
  );
  for (const { symbol, mine, anyDay } of rows) {
    const trades = mine[period];
    const a = anyDay[period];
    const win = trades.filter((t) => t.net > 0).length / trades.length;
    const mean = trades.reduce((x, t) => x + t.net, 0) / trades.length;
    console.log(
      `${symbol.padEnd(4)} n=${String(trades.length).padStart(3)}  win ${(win * 100).toFixed(1)}% (any day ${((a.wins / a.n) * 100).toFixed(1)}%)  mean ${pct(mean)} (any day ${pct(a.sum / a.n)})  edge ${show(interval(trades, (t) => t.edge))}  vs SPY ${show(interval(trades, (t) => t.net - t.spyNet))}`
    );
  }
  const all = pooled[period];
  console.log(
    `POOLED n=${all.length}  win ${((all.reduce((x, t) => x + t.win, 0) / all.length) * 100).toFixed(1)}%  mean ${pct(all.reduce((x, t) => x + t.net, 0) / all.length)}`
  );
  console.log(`  timing edge      ${show(interval(all, (t) => t.edge))}`);
  console.log(`  win-rate edge    ${show(interval(all, (t) => t.winEdge))}`);
  console.log(
    `  excess over SPY  ${show(
      interval(
        all.filter((t) => t.symbol !== 'SPY'),
        (t) => t.net - t.spyNet
      )
    )}  (SPY itself excluded)`
  );
  if (period === 'TEST') {
    for (const [a, b] of [
      ['2013', '2016'],
      ['2017', '2019'],
      ['2020', '2022'],
      ['2023', '2026'],
    ]) {
      const part = all.filter((t) => t.entry.slice(0, 4) >= a && t.entry.slice(0, 4) <= b);
      console.log(
        `  ${a}-${b} n=${part.length}  win ${((part.reduce((x, t) => x + t.win, 0) / part.length) * 100).toFixed(1)}%  edge ${show(interval(part, (t) => t.edge))}`
      );
    }
  }
}
