// More calendar effects on the index: employment report and FOMC days, the turn of the
// month, the November-April half-year and option-expiry week.
//
// REGISTERED on 2026-11-27 before any return of these windows was read. Each rule is its
// own family with its own development and held-out period; TEST is printed only with
// --final=<rule>, for a rule that passed DEV. All positions pay 10 bps per round trip.
//
//   Release days (SPY closes; the schedule is known, so buy the close before the day and
//   sell that day's close). Edge = mean release-day return net of cost - mean of all other
//   sessions; interval by bootstrap over calendar years. DEV 1994-2012, TEST 2013-2026.
//     employment  Employment Situation release dates (ALFRED release 50)
//     fomc        last day of each scheduled FOMC meeting (federalreserve.gov)
//
//   Windows (S&P 500 price index closes; cash earns nothing). DEV 1950-1989,
//   TEST 1990-2026. Interval by bootstrap over calendar years.
//     turn-of-month  buy the close of the second-to-last session of a month, sell the
//                    close of the third session of the next (four sessions held).
//                    Edge = window return - mean of every four-session hold.
//     halloween      buy the last close of October, sell the last close of April.
//                    Edge = that return - the return from the last close of April to
//                    the last close of October that follows.
//     opex-week      buy the last close before the week of the third Friday, sell that
//                    Friday's close (or the last session of that week).
//                    Edge = window return - mean of every hold of the same length.
//   Pass on a period: the edge interval is above zero.
//   For a window rule the account that holds the index only inside the windows is shown
//   beside buy and hold, because an edge over the average window does not by itself beat
//   holding the index.
import fs from 'node:fs';

const DIR = process.env.EVENT_DATA ?? 'data/strategy-validation/events-20261127';
const COST = 0.001;
const finalArg = process.argv.find((a) => a.startsWith('--final='))?.split('=')[1];
const load = (symbol) => {
  const rows = JSON.parse(fs.readFileSync(`${DIR}/${symbol}.json`, 'utf8'));
  return { date: rows.map((r) => r[0]), close: rows.map((r) => r[4]) };
};
const datesIn = (file) =>
  new Set(
    [...fs.readFileSync(`${DIR}/${file}`, 'utf8').matchAll(/^(\d{4}-\d{2}-\d{2})\s*$/gm)].map(
      (m) => m[1]
    )
  );
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
// groups: per-year { sum, n } of edge values; resampled with replacement.
function interval(groups) {
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
const yearOf = (date) => Number(date.slice(0, 4));
function byYear(items) {
  const groups = new Map();
  for (const { year, value } of items) {
    const g = groups.get(year) ?? { sum: 0, n: 0 };
    g.sum += value;
    g.n++;
    groups.set(year, g);
  }
  return [...groups.values()];
}

// ── Release days ──────────────────────────────────────────────────────────
const spy = load('SPY');
function releaseDays(name, file, label, fromYear, toYear) {
  const days = datesIn(file);
  const release = [];
  const other = [];
  for (let i = 1; i < spy.close.length; i++) {
    const year = yearOf(spy.date[i]);
    if (year < fromYear || year > toYear) continue;
    const r = spy.close[i] / spy.close[i - 1] - 1;
    (days.has(spy.date[i]) ? release : other).push({ year, r });
  }
  const otherMean = avg(other.map((x) => x.r));
  const edge = (cost) => {
    const items = release.map((x) => ({ year: x.year, value: x.r - cost - otherMean }));
    const ci = interval(byYear(items));
    return `${pct(avg(items.map((x) => x.value)), 3)} [${pct(ci[0], 3)}, ${pct(ci[1], 3)}]`;
  };
  console.log(
    `${name} ${label} ${fromYear}-${toYear}: days ${release.length}  mean ${pct(avg(release.map((x) => x.r)), 3)}  up ${((release.filter((x) => x.r > 0).length / release.length) * 100).toFixed(1)}%  | other days mean ${pct(otherMean, 3)}  | edge at 10 bps ${edge(COST)}  | at 1 bp ${edge(0.0001)}`
  );
}
for (const [name, file] of [
  ['employment', 'employment-release-dates.txt'],
  ['fomc', 'fomc-meeting-dates.txt'],
]) {
  releaseDays(name, file, 'DEV', 1994, 2012);
  if (finalArg === name) releaseDays(name, file, 'TEST', 2013, 2026);
}

// ── Windows on the index ──────────────────────────────────────────────────
const index = load('GSPC');
const n = index.close.length;
const monthOf = (i) => index.date[i].slice(0, 7);
const lastOfMonth = [];
for (let i = 0; i + 1 < n; i++) if (monthOf(i) !== monthOf(i + 1)) lastOfMonth.push(i);

function windowsFor(rule) {
  const out = [];
  if (rule === 'turn-of-month') {
    for (const last of lastOfMonth)
      if (last >= 1 && last + 3 < n) out.push({ i: last - 1, j: last + 3 });
  } else if (rule === 'opex-week') {
    for (let k = 0; k + 1 < lastOfMonth.length; k++) {
      const first = lastOfMonth[k] + 1;
      const [year, month] = monthOf(first).split('-').map(Number);
      const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
      const thirdFriday = 1 + ((5 - firstWeekday + 7) % 7) + 14;
      const friday = `${monthOf(first)}-${String(thirdFriday).padStart(2, '0')}`;
      const monday = new Date(Date.UTC(year, month - 1, thirdFriday - 4))
        .toISOString()
        .slice(0, 10);
      let i = -1;
      let j = -1;
      for (let s = first; s <= lastOfMonth[k + 1]; s++) {
        if (index.date[s] >= monday && index.date[s] <= friday) {
          if (i === -1) i = s - 1;
          j = s;
        }
      }
      if (i >= 0 && j > i) out.push({ i, j });
    }
  }
  return out;
}
function account(windows, from, to) {
  // Index only inside the windows, cash outside; closes; cost at each exit.
  const held = new Uint8Array(n);
  const exits = new Set();
  for (const w of windows) {
    for (let s = w.i + 1; s <= w.j; s++) held[s] = 1;
    exits.add(w.j);
  }
  let equity = 1;
  let peak = 1;
  let drawdown = 0;
  let hold = 1;
  let holdPeak = 1;
  let holdDrawdown = 0;
  let inside = 0;
  let sessions = 0;
  for (let s = from + 1; s <= to; s++) {
    const r = index.close[s] / index.close[s - 1] - 1;
    hold *= 1 + r;
    holdPeak = Math.max(holdPeak, hold);
    holdDrawdown = Math.max(holdDrawdown, 1 - hold / holdPeak);
    if (held[s]) {
      equity *= 1 + r;
      inside++;
    }
    if (exits.has(s)) equity *= 1 - COST;
    peak = Math.max(peak, equity);
    drawdown = Math.max(drawdown, 1 - equity / peak);
    sessions++;
  }
  const years = sessions / 252;
  return `account in windows only: ${pct(equity ** (1 / years) - 1, 1)} a year, max drawdown ${(drawdown * 100).toFixed(0)}%, in the market ${((inside / sessions) * 100).toFixed(0)}% of sessions | buy and hold ${pct(hold ** (1 / years) - 1, 1)} a year, max drawdown ${(holdDrawdown * 100).toFixed(0)}%`;
}
function windowRule(rule, label, fromYear, toYear) {
  const from = index.date.findIndex((d) => yearOf(d) >= fromYear);
  let to = n - 1;
  while (yearOf(index.date[to]) > toYear) to--;
  const windows = windowsFor(rule).filter((w) => w.i >= from && w.j <= to);
  const lengths = [...new Set(windows.map((w) => w.j - w.i))];
  const baseline = new Map();
  for (const length of lengths) {
    let sum = 0;
    let count = 0;
    for (let s = from; s + length <= to; s++) {
      sum += index.close[s + length] / index.close[s] - 1 - COST;
      count++;
    }
    baseline.set(length, sum / count);
  }
  const items = windows.map((w) => {
    const net = index.close[w.j] / index.close[w.i] - 1 - COST;
    return { year: yearOf(index.date[w.j]), net, value: net - baseline.get(w.j - w.i) };
  });
  const ci = interval(byYear(items));
  console.log(
    `${rule} ${label} ${fromYear}-${toYear}: windows ${items.length}  mean net ${pct(avg(items.map((x) => x.net)), 3)}  positive ${((items.filter((x) => x.net > 0).length / items.length) * 100).toFixed(1)}%  | edge over any window ${pct(avg(items.map((x) => x.value)), 3)} [${pct(ci[0], 3)}, ${pct(ci[1], 3)}]`
  );
  console.log(`   ${account(windows, from, to)}`);
}
function halloween(label, fromYear, toYear) {
  const items = [];
  for (let k = 0; k + 12 < lastOfMonth.length; k++) {
    const i = lastOfMonth[k];
    if (index.date[i].slice(5, 7) !== '10') continue;
    const year = yearOf(index.date[i]);
    if (year < fromYear || year + 1 > toYear) continue;
    const april = lastOfMonth[k + 6];
    const october = lastOfMonth[k + 12];
    const winter = index.close[april] / index.close[i] - 1 - COST;
    const summer = index.close[october] / index.close[april] - 1 - COST;
    items.push({ year, winter, summer, value: winter - summer });
  }
  const ci = interval(items.map((x) => ({ sum: x.value, n: 1 })));
  const compound = (f) => items.reduce((a, x) => a * (1 + f(x)), 1) ** (1 / items.length) - 1;
  console.log(
    `halloween ${label} ${fromYear}-${toYear}: years ${items.length}  Nov-Apr mean ${pct(avg(items.map((x) => x.winter)))} (positive ${items.filter((x) => x.winter > 0).length})  May-Oct mean ${pct(avg(items.map((x) => x.summer)))} (positive ${items.filter((x) => x.summer > 0).length})  | edge ${pct(avg(items.map((x) => x.value)))} [${pct(ci[0])}, ${pct(ci[1])}]`
  );
  console.log(
    `   account Nov-Apr only: ${pct(
      compound((x) => x.winter),
      1
    )} a year | buy and hold ${pct(
      compound((x) => (1 + x.winter + COST) * (1 + x.summer + COST) - 1),
      1
    )} a year`
  );
}
for (const rule of ['turn-of-month', 'opex-week']) {
  windowRule(rule, 'DEV', 1950, 1989);
  if (finalArg === rule) windowRule(rule, 'TEST', 1990, 2026);
}
halloween('DEV', 1950, 1989);
if (finalArg === 'halloween') halloween('TEST', 1990, 2026);
