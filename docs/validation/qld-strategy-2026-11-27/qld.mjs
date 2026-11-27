// A QLD (2x Nasdaq-100) strategy: when to hold the leveraged fund and when to stand aside.
//
// REGISTERED on 2026-11-27 before any result of this script was read:
//   - Signals use QQQ closes only. A weight decided on the close of session t is held from
//     the open of t+1 to the open of t+2. The rest of the account is cash at 0%.
//     Every change of weight pays 5 bps on the amount traded (10 bps per full round trip).
//   - Vehicle: QLD's actual adjusted opens from 2006-06-22. Before that, a synthetic 2x
//     fund: twice QQQ's open-to-open return minus 0.95% a year and minus the 13-week
//     T-bill yield a year on the borrowed half. The synthetic is checked against the real
//     fund over 2006-06 .. 2012 and that check is printed.
//   - Four rules, no others:
//       sma200        QLD while QQQ closes above its 200-session average, else cash
//       gaussian      QLD while the project's Gaussian filter (144, 4 poles) is not
//                     falling, else cash: the trend gate the stock pipeline already uses
//       vol20         weight = min(1, 20% / (2 x QQQ's 20-session annualised volatility)),
//                     changed only when it moves by 10 points
//       sma200+vol20  the vol20 weight while above the 200-session average, else cash
//   - DEV = 2000-01-03 .. 2012-12-31 (dot-com collapse and 2008 included).
//     TEST = 2013-01-02 .. 2026-11-25, real QLD only, printed with --final=<rule>.
//   - Choice on DEV: the highest CAGR among rules whose DEV maximum drawdown is 50% or
//     less; if none, the smallest drawdown.
//   - Pass on TEST: CAGR above QQQ buy and hold, and maximum drawdown no deeper than 1.25
//     times QQQ buy and hold's in the same period.
//   Drawdowns are measured on daily opens. This is a leveraged fund: the pass bar is about
//   return for a bounded drawdown, not about skill.
import fs from 'node:fs';

const DIR = process.env.QLD_DATA ?? 'data/strategy-validation/qld-20261127';
const finalArg = process.argv.find((a) => a.startsWith('--final='))?.split('=')[1];
const DEV = ['2000-01-03', '2012-12-31'];
const TEST = ['2013-01-02', '2026-11-25'];
const SWITCH_COST = 0.0005;

const read = (symbol) => JSON.parse(fs.readFileSync(`${DIR}/${symbol}.json`, 'utf8'));
const qqqRows = read('QQQ');
const dates = qqqRows.map((r) => r[0]);
const n = dates.length;
const open = qqqRows.map((r) => r[1]);
const close = qqqRows.map((r) => r[4]);
const byDate = (symbol, column) => {
  const map = new Map(read(symbol).map((r) => [r[0], r[column]]));
  return dates.map((d) => map.get(d) ?? Number.NaN);
};
const qldOpen = byDate('QLD', 1);
const spyOpen = byDate('SPY', 1);
const bill = byDate('IRX', 4);

// Open-to-open return of the 2x vehicle from session k to k+1.
let lastBill = 0;
const leveraged = new Float64Array(n).fill(Number.NaN);
const synthetic = new Float64Array(n).fill(Number.NaN);
for (let k = 0; k + 1 < n; k++) {
  if (Number.isFinite(bill[k])) lastBill = bill[k] / 100;
  synthetic[k] = 2 * (open[k + 1] / open[k] - 1) - (0.0095 + lastBill) / 252;
  const real = qldOpen[k] > 0 && qldOpen[k + 1] > 0 ? qldOpen[k + 1] / qldOpen[k] - 1 : Number.NaN;
  leveraged[k] = Number.isFinite(real) ? real : synthetic[k];
}

// ── indicators on QQQ closes ──────────────────────────────────────────────
const sma200 = new Float64Array(n).fill(Number.NaN);
let sum = 0;
for (let i = 0; i < n; i++) {
  sum += close[i];
  if (i >= 200) sum -= close[i - 200];
  if (i >= 199) sma200[i] = sum / 200;
}
// Same recursion as packages/core/src/services/gaussian-channel.ts.
const PERIOD = 144;
const POLES = 4;
const beta = (1 - Math.cos((2 * Math.PI) / PERIOD)) / (Math.SQRT2 ** (2 / POLES) - 1);
const alpha = -beta + Math.sqrt(beta * beta + 2 * beta);
const state = Array.from({ length: POLES }, () => new Float64Array(n).fill(close[0]));
for (let i = 1; i < n; i++) {
  state[0][i] = alpha * close[i] + (1 - alpha) * state[0][i - 1];
  for (let p = 1; p < POLES; p++)
    state[p][i] = alpha * state[p - 1][i] + (1 - alpha) * state[p][i - 1];
}
const filter = state[POLES - 1];
const falling = (i) => i > 0 && filter[i] - filter[i - 1] < -Math.abs(filter[i]) * 1e-8;
const volatility = new Float64Array(n).fill(Number.NaN);
for (let i = 20; i < n; i++) {
  let s = 0;
  let sq = 0;
  for (let k = i - 19; k <= i; k++) {
    const r = close[k] / close[k - 1] - 1;
    s += r;
    sq += r * r;
  }
  volatility[i] = Math.sqrt(Math.max(sq / 20 - (s / 20) ** 2, 0) * 252);
}
const volWeight = (i) => (volatility[i] > 0 ? Math.min(1, 0.2 / (2 * volatility[i])) : 0);

const RULES = {
  sma200: (i) => (close[i] > sma200[i] ? 1 : 0),
  gaussian: (i) => (falling(i) ? 0 : 1),
  vol20: (i, held) => {
    const target = volWeight(i);
    return Math.abs(target - held) >= 0.1 || target === 0 ? target : held;
  },
  'sma200+vol20': (i, held) => {
    if (!(close[i] > sma200[i])) return 0;
    const target = volWeight(i);
    return Math.abs(target - held) >= 0.1 || held === 0 ? target : held;
  },
};

// ── Averaging down ────────────────────────────────────────────────────────
// REGISTERED on 2026-11-27, after the rules above, before any result of these was read:
//   - Drawdown = QQQ close against its highest close of the last 252 sessions.
//   - Ladder level = the deepest of the steps -10 / -20 / -30 / -40% reached since QQQ
//     last closed at a 252-session high; a new 252-session high resets it to zero.
//     So weight is added as the index falls and the added part is sold at the recovery.
//   - Four rules, no others:
//       ladder-50   50% QLD, plus 12.5 points per level (100% at -40%)
//       ladder-25   25% QLD, plus 25 points per level (100% at -30%)
//       dip-only    cash until -10%, then 25 points per level (100% at -40%)
//       vol20+dip   the volatility weight, but never below 50 / 75 / 100% once the
//                   level is 2 / 3 / 4 (buy the fall that the volatility weight sells)
//   - Read with --ladder on the same spans and against the same bar as the rules above.
const high252 = new Float64Array(n).fill(Number.NaN);
const ladderLevel = new Uint8Array(n);
for (let i = 0; i < n; i++) {
  let high = 0;
  for (let k = Math.max(0, i - 251); k <= i; k++) high = Math.max(high, close[k]);
  high252[i] = high;
  const fall = 1 - close[i] / high;
  const step = fall >= 0.4 ? 4 : fall >= 0.3 ? 3 : fall >= 0.2 ? 2 : fall >= 0.1 ? 1 : 0;
  ladderLevel[i] = close[i] >= high ? 0 : Math.max(i > 0 ? ladderLevel[i - 1] : 0, step);
}
const LADDER_RULES = {
  'ladder-50': (i) => 0.5 + 0.125 * ladderLevel[i],
  'ladder-25': (i) => Math.min(1, 0.25 + 0.25 * ladderLevel[i]),
  'dip-only': (i) => 0.25 * ladderLevel[i],
  'vol20+dip': (i, held) => {
    const target = Math.max(volWeight(i), [0, 0, 0.5, 0.75, 1][ladderLevel[i]]);
    return Math.abs(target - held) >= 0.1 || target === 0 ? target : held;
  },
};
const ladderMode = process.argv.includes('--ladder');
if (ladderMode) Object.assign(RULES, LADDER_RULES);

function stats(returns, extra = {}) {
  let equity = 1;
  let peak = 1;
  let drawdown = 0;
  let s = 0;
  let sq = 0;
  let worst = 0;
  for (const r of returns) {
    equity *= 1 + r;
    peak = Math.max(peak, equity);
    drawdown = Math.max(drawdown, 1 - equity / peak);
    s += r;
    sq += r * r;
    worst = Math.min(worst, r);
  }
  const mean = s / returns.length;
  const deviation = Math.sqrt(sq / returns.length - mean * mean);
  return {
    cagr: equity ** (252 / returns.length) - 1,
    drawdown,
    sharpe: deviation ? (mean / deviation) * Math.sqrt(252) : 0,
    worst,
    total: equity - 1,
    ...extra,
  };
}
function run(rule, from, to) {
  // Sessions k in [from, to): the weight decided on close k-1 is held from open k to open k+1.
  const returns = [];
  let held = 0;
  let traded = 0;
  let exposure = 0;
  let changes = 0;
  for (let k = from; k < to; k++) {
    const want = k >= 201 ? RULES[rule](k - 1, held) : 0;
    const delta = Math.abs(want - held);
    if (delta > 0) {
      changes++;
      traded += delta;
    }
    held = want;
    returns.push(held * leveraged[k] - delta * SWITCH_COST);
    exposure += held;
  }
  return stats(returns, {
    returns,
    exposure: exposure / returns.length,
    changesPerYear: changes / (returns.length / 252),
    held,
  });
}
function hold(series, from, to) {
  const returns = [];
  for (let k = from; k < to; k++) returns.push(series(k));
  return stats(returns, { returns });
}
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
// Mean daily return difference from QQQ, a year, with a bootstrap over calendar months.
function excess(rule, qqq, from) {
  const months = new Map();
  rule.returns.forEach((r, i) => {
    const key = dates[from + i].slice(0, 7);
    const g = months.get(key) ?? { sum: 0, n: 0 };
    g.sum += r - qqq.returns[i];
    g.n++;
    months.set(key, g);
  });
  const list = [...months.values()];
  const random = rng(20261127);
  const means = [];
  for (let b = 0; b < 2000; b++) {
    let s = 0;
    let c = 0;
    for (let k = 0; k < list.length; k++) {
      const g = list[Math.floor(random() * list.length)];
      s += g.sum;
      c += g.n;
    }
    means.push((s / c) * 252);
  }
  means.sort((x, y) => x - y);
  const mean = (list.reduce((x, g) => x + g.sum, 0) / list.reduce((x, g) => x + g.n, 0)) * 252;
  return `  mean daily return over QQQ, a year: ${pct(mean)} [${pct(means[49])}, ${pct(means[1949])}]`;
}
const pct = (x, d = 1) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}%`;
const line = (label, s) =>
  `${label.padEnd(26)} CAGR ${pct(s.cagr).padStart(7)}  max drawdown ${(s.drawdown * 100).toFixed(0).padStart(3)}%  Sharpe ${s.sharpe.toFixed(2)}  worst session ${pct(s.worst)}${s.exposure === undefined ? '' : `  average weight ${(s.exposure * 100).toFixed(0)}%  changes a year ${s.changesPerYear.toFixed(1)}`}`;
const indexOf = (date) => dates.findIndex((d) => d >= date);

// Synthetic check over the overlap with the real fund.
{
  const from = indexOf('2006-06-22');
  const to = indexOf('2013-01-02');
  const real = hold((k) => qldOpen[k + 1] / qldOpen[k] - 1, from, to);
  const model = hold((k) => synthetic[k], from, to);
  console.log(
    `synthetic 2x check ${dates[from]}..${dates[to - 1]}: real QLD ${pct(real.cagr)} a year (max drawdown ${(real.drawdown * 100).toFixed(0)}%), synthetic ${pct(model.cagr)} a year (${(model.drawdown * 100).toFixed(0)}%)`
  );
}

function period(label, [start, end]) {
  const from = indexOf(start);
  let to = n - 1;
  while (dates[to] > end) to--;
  console.log(`\n== ${label} ${dates[from]} .. ${dates[to]} (${to - from} sessions)`);
  const qqq = hold((k) => open[k + 1] / open[k] - 1, from, to);
  console.log(line('QQQ buy and hold', qqq));
  console.log(
    line(
      '2x buy and hold',
      hold((k) => leveraged[k], from, to)
    )
  );
  console.log(
    line(
      'SPY buy and hold',
      hold((k) => spyOpen[k + 1] / spyOpen[k] - 1, from, to)
    )
  );
  const results = {};
  for (const rule of Object.keys(RULES)) {
    if (label === 'TEST' && rule !== finalArg && finalArg !== 'all') continue;
    if (ladderMode && !(rule in LADDER_RULES) && rule !== 'vol20') continue;
    results[rule] = run(rule, from, to);
    console.log(line(rule, results[rule]));
    console.log(excess(results[rule], qqq, from));
  }
  return { qqq, results };
}
// --span=FROM,TO prints every rule over an arbitrary span (description, not a test).
const spanArg = process.argv.find((a) => a.startsWith('--span='))?.split('=')[1];
if (spanArg) {
  period('SPAN', spanArg.split(','));
  process.exit(0);
}
const dev = period('DEV', DEV);
const eligible = Object.entries(dev.results).filter(([, s]) => s.drawdown <= 0.5);
const chosen = (
  eligible.length
    ? eligible.sort((a, b) => b[1].cagr - a[1].cagr)
    : Object.entries(dev.results).sort((a, b) => a[1].drawdown - b[1].drawdown)
)[0][0];
console.log(
  `\nchosen on DEV: ${chosen}${eligible.length ? '' : ' (no rule kept its drawdown within 50%)'}`
);
if (finalArg) {
  const test = period('TEST', TEST);
  const s = test.results[finalArg];
  console.log(
    `\npass bar: CAGR above ${pct(test.qqq.cagr)} and max drawdown within ${(test.qqq.drawdown * 125).toFixed(0)}% -> ${s.cagr > test.qqq.cagr && s.drawdown <= test.qqq.drawdown * 1.25 ? 'PASS' : 'FAIL'}`
  );
  console.log(
    `weight decided on the last close (${dates[n - 1]}): ${(RULES[finalArg](n - 1, s.held) * 100).toFixed(0)}% QLD`
  );

  // Description only: the whole span and each calendar year, for the rule that was run.
  const from = indexOf(DEV[0]);
  console.log(`\n== WHOLE SPAN ${dates[from]} .. ${dates[n - 1]}`);
  console.log(
    line(
      'QQQ buy and hold',
      hold((k) => open[k + 1] / open[k] - 1, from, n - 1)
    )
  );
  console.log(
    line(
      '2x buy and hold',
      hold((k) => leveraged[k], from, n - 1)
    )
  );
  console.log(
    line(
      'SPY buy and hold',
      hold((k) => spyOpen[k + 1] / spyOpen[k] - 1, from, n - 1)
    )
  );
  console.log(line(finalArg, run(finalArg, from, n - 1)));
  const years = [];
  let held = 0;
  let equity = 1;
  let base = 1;
  let qqqBase = open[from];
  let weightSum = 0;
  let count = 0;
  for (let k = from; k < n - 1; k++) {
    const want = RULES[finalArg](k - 1, held);
    const delta = Math.abs(want - held);
    held = want;
    equity *= 1 + held * leveraged[k] - delta * SWITCH_COST;
    weightSum += held;
    count++;
    if (dates[k + 1].slice(0, 4) !== dates[k].slice(0, 4) || k === n - 2) {
      years.push(
        `${dates[k].slice(0, 4)} ${pct(equity / base - 1, 0)} / ${pct(open[k + 1] / qqqBase - 1, 0)} (${((weightSum / count) * 100).toFixed(0)}%)`
      );
      base = equity;
      qqqBase = open[k + 1];
      weightSum = 0;
      count = 0;
    }
  }
  console.log('by year, rule / QQQ (average weight):');
  for (let i = 0; i < years.length; i += 6) console.log(`  ${years.slice(i, i + 6).join('   ')}`);
}
