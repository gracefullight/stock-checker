// Sector momentum rotation on the nine original Select Sector SPDRs.
//
// REGISTERED before any result was read:
//   - At the last close of each month rank the nine sector ETFs by trailing total return
//     over L months (L = 6 primary; 3 and 12 reported on DEV only). Hold the top three in
//     equal weight from the next open to the open after the following month-end.
//     10 bps charged on the whole account every month.
//   - Benchmark: SPY over the same open-to-open months.
//   - DEV = holding months through 2012-12. TEST = 2013-01 onward, printed with --final=L
//     for the single L chosen on DEV. Pass: mean monthly excess over SPY with a 95%
//     bootstrap interval (months resampled, 2,000, seed 20261126) above zero, on DEV and TEST.
import fs from 'node:fs';
const DIR = `${process.env.INDEX_DATA ?? 'data/strategy-validation/index-etfs-20261126'}/`;
const finalArg = process.argv.find((a) => a.startsWith('--final='))?.split('=')[1];
const load = (s) => JSON.parse(fs.readFileSync(`${DIR}${s}.json`, 'utf8'));
const spyRows = load('SPY');
const dates = spyRows.map((b) => String(b.date).slice(0, 10));
const at = new Map(dates.map((d, i) => [d, i]));
const align = (rows) => {
  const o = new Array(dates.length).fill(NaN),
    c = new Array(dates.length).fill(NaN);
  for (const b of rows) {
    const i = at.get(String(b.date).slice(0, 10));
    if (i !== undefined) {
      o[i] = b.open;
      c[i] = b.close;
    }
  }
  return { open: o, close: c };
};
const spy = align(spyRows);
const sectors = ['XLB', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLU', 'XLV', 'XLY'].map((s) => [
  s,
  align(load(s)),
]);
const monthEnds = [];
for (let i = 0; i + 1 < dates.length; i++)
  if (dates[i].slice(0, 7) !== dates[i + 1].slice(0, 7)) monthEnds.push(i);
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
function ci(v) {
  const r = rng(20261126),
    m = [];
  for (let k = 0; k < 2000; k++) {
    let s = 0;
    for (let i = 0; i < v.length; i++) s += v[Math.floor(r() * v.length)];
    m.push(s / v.length);
  }
  m.sort((a, b) => a - b);
  return [m[49], m[1949]];
}
const pct = (x) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)}%`;
function months(L) {
  const out = [];
  for (let m = 12; m + 1 < monthEnds.length; m++) {
    const t = monthEnds[m],
      back = monthEnds[m - L],
      next = monthEnds[m + 1];
    if (next + 1 >= dates.length) break;
    const ranked = sectors
      .map(([s, x]) => [s, x.close[t] / x.close[back] - 1, x.open[next + 1] / x.open[t + 1] - 1])
      .filter((r) => Number.isFinite(r[1]) && Number.isFinite(r[2]));
    if (ranked.length < 9) continue;
    ranked.sort((a, b) => b[1] - a[1]);
    const top = ranked.slice(0, 3).reduce((a, r) => a + r[2], 0) / 3 - 0.001;
    out.push({
      month: dates[t + 1].slice(0, 7),
      top,
      spy: spy.open[next + 1] / spy.open[t + 1] - 1,
      all: ranked.reduce((a, r) => a + r[2], 0) / 9,
    });
  }
  return out;
}
function line(label, rows) {
  const x = rows.map((r) => r.top - r.spy),
    c = ci(x);
  const cagr = (f) => rows.reduce((a, r) => a * (1 + f(r)), 1) ** (12 / rows.length) - 1;
  return `${label.padEnd(16)} months ${rows.length}  rotation ${pct(cagr((r) => r.top))}/yr  SPY ${pct(cagr((r) => r.spy))}/yr  nine sectors equal ${pct(cagr((r) => r.all))}/yr  | monthly excess over SPY ${pct(x.reduce((a, b) => a + b, 0) / x.length)} [${pct(c[0])}, ${pct(c[1])}]  beats SPY ${((x.filter((v) => v > 0).length / x.length) * 100).toFixed(0)}% of months`;
}
for (const L of [3, 6, 12]) {
  const rows = months(L);
  console.log(
    line(
      `L=${L} DEV`,
      rows.filter((r) => r.month < '2013-01')
    )
  );
  if (finalArg === String(L))
    console.log(
      line(
        `L=${L} TEST`,
        rows.filter((r) => r.month >= '2013-01')
      )
    );
}
