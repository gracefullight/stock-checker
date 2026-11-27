// Calendar events on the index: the US election cycle and CPI release days.
//
// REGISTERED on 2026-11-27 before any return around these events was read:
//   Election cycle (S&P 500 price index ^GSPC, closes; opens before 1962 are not real):
//     - Election day is the Tuesday after the first Monday of November in even years;
//       a year divisible by four is a presidential election, otherwise a midterm.
//     - Enter at the close of the first session after election day, hold 252 sessions,
//       10 bps round trip. Benchmark: the same 252-session hold entered at every close of
//       the same period ("any day"). Edge = event return - any-day mean.
//     - Interval: bootstrap over elections (2,000 resamples, seed 20261127).
//     - DEV = elections 1950-1988 (10 midterm, 10 presidential). TEST = 1990-2024
//       (9 and 9). The 2026 midterm window is still open and is excluded.
//       TEST is printed only with --final=midterm or --final=presidential.
//     - Pass on a period: the edge interval is above zero.
//   CPI release days (SPY, closes; release dates from ALFRED, Consumer Price Index):
//     - The schedule is known in advance, so the position is bought at the close before a
//       release day and sold at that day's close.
//     - Edge = mean release-day return net of cost - mean return of all other sessions.
//       Reported at 10 bps (the project's cost) and at 1 bp. Interval: bootstrap over
//       calendar years.
//     - DEV = 1993-2012. TEST = 2013-2026, printed only with --final=cpi.
//     - Pass on a period: the 10 bps edge interval is above zero.
import fs from 'node:fs';

const DIR = process.env.EVENT_DATA ?? 'data/strategy-validation/events-20261127';
const finalArg = process.argv.find((a) => a.startsWith('--final='))?.split('=')[1];
const load = (symbol) => {
  const rows = JSON.parse(fs.readFileSync(`${DIR}/${symbol}.json`, 'utf8'));
  return { date: rows.map((r) => r[0]), open: rows.map((r) => r[1]), close: rows.map((r) => r[4]) };
};
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
function interval(groups) {
  // groups: [{ sum, n }] resampled with replacement.
  const random = rng(20261127);
  const means = [];
  for (let r = 0; r < 2000; r++) {
    let sum = 0;
    let n = 0;
    for (let k = 0; k < groups.length; k++) {
      const g = groups[Math.floor(random() * groups.length)];
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

// ── Election cycle ────────────────────────────────────────────────────────
function electionDay(year) {
  const first = new Date(Date.UTC(year, 10, 1));
  const firstMonday = 1 + ((8 - first.getUTCDay()) % 7);
  return new Date(Date.UTC(year, 10, firstMonday + 1)).toISOString().slice(0, 10);
}
const index = load('GSPC');
const HOLD = 252;
const COST = 0.001;
function elections(kind, fromYear, toYear) {
  const rows = [];
  for (let year = fromYear; year <= toYear; year += 2) {
    if ((year % 4 === 0) !== (kind === 'presidential')) continue;
    const day = electionDay(year);
    const i = index.date.findIndex((d) => d > day);
    if (i < 0 || i + HOLD >= index.close.length) continue;
    rows.push({
      year,
      entry: index.date[i],
      net: index.close[i + HOLD] / index.close[i] - 1 - COST,
    });
  }
  return rows;
}
function anyDay(fromYear, toYear) {
  let sum = 0;
  let wins = 0;
  let n = 0;
  for (let i = 0; i + HOLD < index.close.length; i++) {
    const year = Number(index.date[i].slice(0, 4));
    if (year < fromYear || year > toYear) continue;
    const r = index.close[i + HOLD] / index.close[i] - 1 - COST;
    sum += r;
    if (r > 0) wins++;
    n++;
  }
  return { mean: sum / n, win: wins / n };
}
function electionReport(kind, label, fromYear, toYear) {
  const rows = elections(kind, fromYear, toYear);
  const base = anyDay(fromYear, toYear);
  const edges = rows.map((r) => r.net - base.mean);
  const ci = interval(edges.map((e) => ({ sum: e, n: 1 })));
  console.log(
    `${kind} ${label} ${fromYear}-${toYear}: n=${rows.length}  mean ${pct(avg(rows.map((r) => r.net)))}  positive ${rows.filter((r) => r.net > 0).length}/${rows.length}  | any day ${pct(base.mean)} (positive ${(base.win * 100).toFixed(0)}%)  | edge ${pct(avg(edges))} [${pct(ci[0])}, ${pct(ci[1])}]  | above any-day mean ${edges.filter((e) => e > 0).length}/${rows.length}`
  );
  console.log(`   ${rows.map((r) => `${r.year}:${pct(r.net, 0)}`).join(' ')}`);
}
for (const kind of ['midterm', 'presidential']) {
  electionReport(kind, 'DEV', 1950, 1988);
  if (finalArg === kind) electionReport(kind, 'TEST', 1990, 2024);
}

// ── CPI release days ──────────────────────────────────────────────────────
const spy = load('SPY');
const releases = new Set(
  [
    ...fs
      .readFileSync(`${DIR}/cpi-release-dates.txt`, 'utf8')
      .matchAll(/^(\d{4}-\d{2}-\d{2})\s*$/gm),
  ].map((m) => m[1])
);
function cpiReport(label, fromYear, toYear) {
  const years = new Map();
  for (let i = 1; i < spy.close.length; i++) {
    const year = Number(spy.date[i].slice(0, 4));
    if (year < fromYear || year > toYear) continue;
    const r = spy.close[i] / spy.close[i - 1] - 1;
    const y = years.get(year) ?? { release: [], other: [] };
    (releases.has(spy.date[i]) ? y.release : y.other).push(r);
    years.set(year, y);
  }
  const all = [...years.values()];
  const release = all.flatMap((y) => y.release);
  const other = all.flatMap((y) => y.other);
  const otherMean = avg(other);
  const line = (cost) => {
    const ci = interval(
      all.map((y) => ({
        sum: y.release.reduce((a, r) => a + r - cost - otherMean, 0),
        n: y.release.length,
      }))
    );
    return `${pct(avg(release) - cost - otherMean, 3)} [${pct(ci[0], 3)}, ${pct(ci[1], 3)}]`;
  };
  console.log(
    `cpi ${label} ${fromYear}-${toYear}: release days ${release.length}  mean ${pct(avg(release), 3)}  up ${((release.filter((r) => r > 0).length / release.length) * 100).toFixed(1)}%  | other days ${other.length}  mean ${pct(otherMean, 3)}  up ${((other.filter((r) => r > 0).length / other.length) * 100).toFixed(1)}%  | edge at 10 bps ${line(0.001)}  | at 1 bp ${line(0.0001)}`
  );
}
cpiReport('DEV', 1993, 2012);
if (finalArg === 'cpi') cpiReport('TEST', 2013, 2026);
