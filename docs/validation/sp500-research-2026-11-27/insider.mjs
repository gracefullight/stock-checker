// Insider purchases in S&P 500 members: does officers' and directors' own buying lead returns?
//
// REGISTERED on 2026-11-27 before any return of an insider event was read:
//   - Source: SEC Insider Transactions Data Sets, Form 4 (no amendments), non-derivative
//     open-market purchases (code P) by a reporting owner who is an officer or a director.
//     A row above $1 billion is treated as a reporting error and dropped.
//   - A ticker's 30-day window on filing date d holds every such purchase filed in the
//     30 calendar days ending on d. Two rules, no others:
//       cluster   at least 2 distinct buyers and at least $200,000 in the window
//       large     at least $500,000 in the window, any number of buyers
//   - The ticker must be an S&P 500 member on d (point-in-time) with adjusted bars.
//     Entry at the open of the first session after d, on the first d where the rule holds
//     and no position in the ticker is open. Exit at the close of the 60th session; a
//     series that ends earlier is sold at its last close. 10 bps round trip.
//   - Benchmarks over the same window and cost: SPY, and the priced members of the entry
//     date in equal weight.
//   - Interval: bootstrap over entry quarters (2,000 resamples, seed 20261127), because
//     60-session holds opened in the same quarter share one market.
//   - DEV = entries 2006-01-01 .. 2015-12-31. TEST = entries from 2016-01-01, printed only
//     with --final=<rule>, for a rule that passed DEV.
//   - Pass on a period: mean excess over SPY and over the members both have a 95%
//     interval above zero.
//   --events prints event counts only, without any return.
import fs from 'node:fs';
import { bestBars, dates, memberDays, membersBySession, spyRows } from './data.mjs';

const INSIDER = `${process.env.INSIDER_DATA ?? 'data/strategy-validation/sec-insider-20261127'}/purchases.csv`;
const COST = 0.001;
const HOLD = 60;
const SPLIT = '2016-01-01';
const DEV_FROM = '2006-01-01';
const finalRule = process.argv.find((a) => a.startsWith('--final='))?.split('=')[1];
const eventsOnly = process.argv.includes('--events');
const RULES = {
  cluster: (w) => w.buyers >= 2 && w.value >= 200_000,
  large: (w) => w.value >= 500_000,
};

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
const cache = new Map();
function seriesOf(ticker) {
  if (!cache.has(ticker)) {
    const best = bestBars(ticker, allDays.get(ticker) ?? []);
    cache.set(ticker, best ? align(best.rows) : null);
  }
  return cache.get(ticker);
}
const ok = (x) => Number.isFinite(x) && x > 0;
const shift = (date, n) => new Date(Date.parse(date) + n * 86_400_000).toISOString().slice(0, 10);
function settle(s, i) {
  if (!ok(s.open[i])) return null;
  for (let j = Math.min(i + HOLD - 1, N - 1); j >= i; j--)
    if (ok(s.close[j])) return s.close[j] / s.open[i] - 1 - COST;
  return -COST;
}

// Officer or director purchases by ticker, in filing-date order.
const memberLists = membersBySession(dates);
// Purchases are matched to members by the issuer's CIK, not by the symbol text the filer
// typed: free text such as "N/A" would otherwise be read as the tickers N and A.
const cikMap = JSON.parse(
  fs.readFileSync(INSIDER.replace('purchases.csv', 'cik-map.json'), 'utf8')
);
const tickersOfCik = new Map();
for (const [ticker, rows] of Object.entries(cikMap)) {
  for (const row of rows) {
    if (!tickersOfCik.has(row.cik)) tickersOfCik.set(row.cik, []);
    tickersOfCik.get(row.cik).push({ ticker, first: row.first, last: row.last });
  }
}
const byTicker = new Map();
for (const line of fs.readFileSync(INSIDER, 'utf8').trim().split('\n').slice(1)) {
  const [filed, , , issuerCik, owner, relationship, shares, price] = line.split(',');
  if (filed < '2005-11-01' || !/Director|Officer/.test(relationship)) continue;
  const value = Number(shares) * Number(price);
  if (!(value > 0) || value > 1e9) continue;
  // A company that changed symbol is filed under the symbol it carried on that date.
  for (const { ticker, first, last } of tickersOfCik.get(issuerCik) ?? []) {
    if (filed < shift(first, -90) || filed > shift(last, 90)) continue;
    if (!byTicker.has(ticker)) byTicker.set(ticker, []);
    byTicker.get(ticker).push({ filed, owner, value });
  }
}

const memberAt = new Map();
function isMember(ticker, index) {
  if (!memberAt.has(index)) memberAt.set(index, new Set(memberLists[index]));
  return memberAt.get(index).has(ticker);
}
// The first session strictly after a calendar date.
function sessionAfter(date) {
  let lo = 0;
  let hi = N;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] > date) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}
const universeCache = new Map();
function universeReturn(i) {
  if (!universeCache.has(i)) {
    let sum = 0;
    let n = 0;
    for (const ticker of memberLists[i]) {
      const s = seriesOf(ticker);
      const r = s ? settle(s, i) : null;
      if (r === null) continue;
      sum += r;
      n++;
    }
    universeCache.set(i, n ? sum / n : Number.NaN);
  }
  return universeCache.get(i);
}

function eventsFor(rule) {
  const trades = [];
  for (const [ticker, rows] of byTicker) {
    rows.sort((a, b) => a.filed.localeCompare(b.filed));
    let busyUntil = -1;
    const filingDates = [...new Set(rows.map((r) => r.filed))];
    for (const d of filingDates) {
      const i = sessionAfter(d);
      if (i >= N || i <= busyUntil || dates[i] < DEV_FROM) continue;
      const from = new Date(Date.parse(d) - 30 * 86_400_000).toISOString().slice(0, 10);
      const inside = rows.filter((r) => r.filed > from && r.filed <= d);
      const window = {
        buyers: new Set(inside.map((r) => r.owner)).size,
        value: inside.reduce((a, r) => a + r.value, 0),
      };
      if (!RULES[rule](window)) continue;
      // Membership is judged on the last session at or before the filing date.
      if (!isMember(ticker, Math.max(i - 1, 0))) continue;
      trades.push({ ticker, filed: d, entryIdx: i, entry: dates[i], ...window });
      busyUntil = i + HOLD - 1;
    }
  }
  return trades.sort((a, b) => a.entry.localeCompare(b.entry) || a.ticker.localeCompare(b.ticker));
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
function interval(trades, value) {
  const groups = new Map();
  for (const t of trades) {
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
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : Number.NaN);

function report(label, trades) {
  if (!trades.length) return console.log(`${label.padEnd(18)} no trades`);
  const a = interval(trades, (t) => t.net - t.spyNet);
  const b = interval(trades, (t) => t.net - t.universeNet);
  console.log(
    [
      label.padEnd(18),
      `n=${String(trades.length).padStart(4)}`,
      `win ${((trades.filter((t) => t.net > 0).length / trades.length) * 100).toFixed(1)}%`,
      `(SPY ${((trades.filter((t) => t.spyNet > 0).length / trades.length) * 100).toFixed(1)}%)`,
      `mean ${pct(avg(trades.map((t) => t.net)))}`,
      `SPY ${pct(avg(trades.map((t) => t.spyNet)))}`,
      `members ${pct(avg(trades.map((t) => t.universeNet)))}`,
      `| over SPY ${pct(avg(trades.map((t) => t.net - t.spyNet)))} [${pct(a[0])}, ${pct(a[1])}]`,
      `| over members ${pct(avg(trades.map((t) => t.net - t.universeNet)))} [${pct(b[0])}, ${pct(b[1])}]`,
      `| beat SPY ${((trades.filter((t) => t.net > t.spyNet).length / trades.length) * 100).toFixed(1)}%`,
    ].join('  ')
  );
}

for (const rule of Object.keys(RULES)) {
  const events = eventsFor(rule);
  const priced = [];
  let unpriced = 0;
  for (const event of events) {
    const s = seriesOf(event.ticker);
    const net = s ? settle(s, event.entryIdx) : null;
    if (net === null || event.entryIdx + HOLD - 1 >= N) {
      unpriced++;
      continue;
    }
    priced.push({ ...event, net });
  }
  const byYear = new Map();
  for (const e of priced)
    byYear.set(e.entry.slice(0, 4), (byYear.get(e.entry.slice(0, 4)) ?? 0) + 1);
  console.log(
    `\n${rule}: ${events.length} events, ${priced.length} priced with a full hold, ${unpriced} dropped | per year ${[...byYear].map(([y, n]) => `${y.slice(2)}:${n}`).join(' ')}`
  );
  if (eventsOnly) continue;
  for (const t of priced) {
    const j = t.entryIdx + HOLD - 1;
    t.spyNet = spy.close[j] / spy.open[t.entryIdx] - 1 - COST;
    t.universeNet = universeReturn(t.entryIdx);
  }
  const dev = priced.filter((t) => t.entry < SPLIT);
  report(`${rule} DEV`, dev);
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
  if (finalRule === rule) {
    const test = priced.filter((t) => t.entry >= SPLIT);
    report(`${rule} TEST`, test);
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
}
