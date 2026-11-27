// Earnings announcement premium in S&P 500 members: hold each stock across the window in
// which it is expected to report.
//
// REGISTERED on 2026-11-27 before any return of an announcement window was read. Only the
// spacing of announcement dates was inspected first: 68% fall within 3 calendar days of
// the prior year's date plus 364 days, and 91% within 7.
//   - Announcement dates: SEC 8-K filings carrying item 2.02 (results of operations), per
//     CIK, from the EDGAR submissions API. Dates within 20 days of each other are one
//     announcement (the earliest).
//   - Expected date P = a past announcement plus 364 calendar days. Nothing from the year
//     being traded is used, so P is known a year ahead.
//   - Position: enter at the open of the session 5 sessions before the first session on or
//     after P, exit at the close of the session 5 sessions after it (11 sessions held).
//     The ticker must be an S&P 500 member on the entry session, with adjusted bars, and
//     the CIK must be the one filing under that ticker at the time. A series that ends
//     inside the hold is sold at its last close. 10 bps round trip.
//   - Benchmarks over the same window and cost: SPY, and the priced members of the entry
//     session in equal weight.
//   - Interval: bootstrap over entry quarters (2,000 resamples, seed 20261127).
//   - DEV = entries 2006-01-01 .. 2015-12-31. TEST = entries from 2016-01-01, printed only
//     with --final, and only if DEV passes.
//   - Pass on a period: mean excess over SPY and over the members both have a 95%
//     interval above zero.
import fs from 'node:fs';
import { bestBars, dates, memberDays, membersBySession, spyRows } from './data.mjs';

const BASE = process.env.INSIDER_DATA ?? 'data/strategy-validation/sec-insider-20261127';
const COST = 0.001;
const BEFORE = 5;
const AFTER = 5;
const SPLIT = '2016-01-01';
const DEV_FROM = '2006-01-01';
const final = process.argv.includes('--final');
const countOnly = process.argv.includes('--events');

const at = new Map(dates.map((d, i) => [d, i]));
const N = dates.length;
function align(rows) {
  const open = new Float64Array(N).fill(Number.NaN);
  const close = new Float64Array(N).fill(Number.NaN);
  for (const row of rows) {
    const i = at.get(row[0]);
    if (i === undefined) continue;
    open[i] = row[1];
    close[i] = row[4];
  }
  return { open, close };
}
const spy = align(spyRows);
const allDays = memberDays();
const memberLists = membersBySession(dates);
const cache = new Map();
function seriesOf(ticker) {
  if (!cache.has(ticker)) {
    const best = bestBars(ticker, allDays.get(ticker) ?? []);
    cache.set(ticker, best ? align(best.rows) : null);
  }
  return cache.get(ticker);
}
const ok = (x) => Number.isFinite(x) && x > 0;
function settle(s, i, j) {
  if (!ok(s.open[i])) return null;
  for (let k = j; k >= i; k--) if (ok(s.close[k])) return s.close[k] / s.open[i] - 1 - COST;
  return -COST;
}
const shift = (date, n) => new Date(Date.parse(date) + n * 86_400_000).toISOString().slice(0, 10);
function sessionOnOrAfter(date) {
  let lo = 0;
  let hi = N;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] >= date) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

const cikMap = JSON.parse(fs.readFileSync(`${BASE}/cik-map.json`, 'utf8'));
const announcements = JSON.parse(fs.readFileSync(`${BASE}/earnings-8k.json`, 'utf8'));
const memberAt = new Map();
function isMember(ticker, index) {
  if (!memberAt.has(index)) memberAt.set(index, new Set(memberLists[index]));
  return memberAt.get(index).has(ticker);
}
const universeCache = new Map();
function universeReturn(i, j) {
  const key = i * 8192 + j;
  if (!universeCache.has(key)) {
    let sum = 0;
    let n = 0;
    for (const ticker of memberLists[i]) {
      const s = seriesOf(ticker);
      const r = s ? settle(s, i, j) : null;
      if (r === null) continue;
      sum += r;
      n++;
    }
    universeCache.set(key, n ? sum / n : Number.NaN);
  }
  return universeCache.get(key);
}

const trades = [];
let outside = 0;
for (const [ticker, rows] of Object.entries(cikMap)) {
  const taken = new Set();
  for (const { cik, first, last } of rows) {
    const merged = [];
    for (const date of announcements[cik]?.dates ?? []) {
      if (!merged.length || date > shift(merged.at(-1), 20)) merged.push(date);
    }
    for (const past of merged) {
      const expected = shift(past, 364);
      // The company must be filing under this ticker around the expected date.
      if (expected < shift(first, -90) || expected > shift(last, 90)) continue;
      const centre = sessionOnOrAfter(expected);
      const i = centre - BEFORE;
      const j = centre + AFTER;
      if (i < 0 || j >= N || dates[i] < DEV_FROM || taken.has(i)) continue;
      if (!isMember(ticker, i)) {
        outside++;
        continue;
      }
      taken.add(i);
      trades.push({ ticker, expected, entryIdx: i, exitIdx: j, entry: dates[i] });
    }
  }
}
trades.sort((a, b) => a.entry.localeCompare(b.entry) || a.ticker.localeCompare(b.ticker));

const priced = [];
for (const t of trades) {
  const s = seriesOf(t.ticker);
  if (!s || !ok(s.open[t.entryIdx])) continue;
  priced.push(t);
}
const perYear = new Map();
for (const t of priced)
  perYear.set(t.entry.slice(0, 4), (perYear.get(t.entry.slice(0, 4)) ?? 0) + 1);
console.log(
  `expected announcement windows: ${trades.length} for members (${outside} outside the index), ${priced.length} priced | per year ${[...perYear].map(([y, n]) => `${y.slice(2)}:${n}`).join(' ')}`
);
if (countOnly) process.exit(0);

for (const t of priced) {
  t.net = settle(seriesOf(t.ticker), t.entryIdx, t.exitIdx);
  t.spyNet = spy.close[t.exitIdx] / spy.open[t.entryIdx] - 1 - COST;
  t.universeNet = universeReturn(t.entryIdx, t.exitIdx);
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
const quarterOf = (date) =>
  `${date.slice(0, 4)}q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;
function interval(rows, value) {
  const groups = new Map();
  for (const t of rows) {
    const g = groups.get(quarterOf(t.entry)) ?? { sum: 0, n: 0 };
    g.sum += value(t);
    g.n++;
    groups.set(quarterOf(t.entry), g);
  }
  const list = [...groups.values()];
  const random = rng(20261127);
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
  return [means[49], means[1949]];
}
const pct = (x, d = 2) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}%`;
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
function report(label, rows) {
  if (!rows.length) return console.log(`${label.padEnd(14)} no trades`);
  const a = interval(rows, (t) => t.net - t.spyNet);
  const b = interval(rows, (t) => t.net - t.universeNet);
  console.log(
    [
      label.padEnd(14),
      `n=${String(rows.length).padStart(5)}`,
      `win ${((rows.filter((t) => t.net > 0).length / rows.length) * 100).toFixed(1)}%`,
      `(SPY ${((rows.filter((t) => t.spyNet > 0).length / rows.length) * 100).toFixed(1)}%)`,
      `mean ${pct(avg(rows.map((t) => t.net)))}`,
      `SPY ${pct(avg(rows.map((t) => t.spyNet)))}`,
      `members ${pct(avg(rows.map((t) => t.universeNet)))}`,
      `| over SPY ${pct(avg(rows.map((t) => t.net - t.spyNet)))} [${pct(a[0])}, ${pct(a[1])}]`,
      `| over members ${pct(avg(rows.map((t) => t.net - t.universeNet)))} [${pct(b[0])}, ${pct(b[1])}]`,
      `| beat SPY ${((rows.filter((t) => t.net > t.spyNet).length / rows.length) * 100).toFixed(1)}%`,
    ].join('  ')
  );
}
const dev = priced.filter((t) => t.entry < SPLIT);
report('DEV', dev);
for (const [a, b] of [
  ['2006', '2007'],
  ['2008', '2009'],
  ['2010', '2012'],
  ['2013', '2015'],
])
  report(
    `  ${a}-${b}`,
    dev.filter((t) => t.entry.slice(0, 4) >= a && t.entry.slice(0, 4) <= b)
  );
if (final) {
  const test = priced.filter((t) => t.entry >= SPLIT);
  report('TEST', test);
  for (const [a, b] of [
    ['2016', '2019'],
    ['2020', '2022'],
    ['2023', '2026'],
  ])
    report(
      `  ${a}-${b}`,
      test.filter((t) => t.entry.slice(0, 4) >= a && t.entry.slice(0, 4) <= b)
    );
}
