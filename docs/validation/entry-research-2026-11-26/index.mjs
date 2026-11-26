// Index pullback study on SPY (1993+) and QQQ (1999+), adjusted OHLC from Yahoo.
//
// PROTOCOL (fixed before any result was read):
//   - Signal on a completed session t; entry at the open of t+1; one position per instrument.
//   - Rules, all taken from published descriptions with their usual constants, none tuned:
//       ibs    (close - low) / (high - low) < 0.2
//       rsi2   Wilder RSI(2) < 10
//       down3  three consecutive lower closes
//     each with and without "close above its 200-session average".
//   - Exits: fixed-5 (fifth session close, the shipped convention), fixed-10, and
//     prior-high-10 (open after the first close above the previous session's high,
//     otherwise the tenth close) exactly as registered in the forward exit study.
//   - 10 bps round trip per trade.
//   - DEV = entries through 2012-12-31. TEST = entries from 2013-01-01, printed only
//     with --final=<rule>/<exit>. One rule is chosen on DEV and run once on TEST.
//   - Timing benchmark: every window of the same rule-independent kind in the same period.
//     For fixed-N exits, all N-session open-to-close windows (same cost). The interval is a
//     bootstrap over entry months (2,000 resamples, seed 20261126) on trade minus the
//     unconditional mean.
import fs from 'node:fs';

const DIR = `${process.env.INDEX_DATA ?? 'data/strategy-validation/index-etfs-20261126'}/`;
const COST = 0.001;
const SPLIT = '2013-01-01';
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);

function loadSeries(symbol) {
  const rows = JSON.parse(fs.readFileSync(`${DIR}${symbol}.json`, 'utf8'));
  const s = { date: [], open: [], high: [], low: [], close: [] };
  for (const b of rows) {
    s.date.push(String(b.date).slice(0, 10));
    s.open.push(b.open);
    s.high.push(b.high);
    s.low.push(b.low);
    s.close.push(b.close);
  }
  const n = s.close.length;
  s.sma200 = new Array(n).fill(Number.NaN);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += s.close[i];
    if (i >= 200) sum -= s.close[i - 200];
    if (i >= 199) s.sma200[i] = sum / 200;
  }
  s.rsi2 = new Array(n).fill(Number.NaN);
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < n; i++) {
    const change = s.close[i] - s.close[i - 1];
    const up = Math.max(change, 0);
    const down = Math.max(-change, 0);
    if (i <= 2) {
      gain += up / 2;
      loss += down / 2;
    } else {
      gain = (gain + up) / 2;
      loss = (loss + down) / 2;
    }
    if (i >= 2) s.rsi2[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return s;
}

const base = {
  ibs: (s, t) => s.high[t] > s.low[t] && (s.close[t] - s.low[t]) / (s.high[t] - s.low[t]) < 0.2,
  rsi2: (s, t) => s.rsi2[t] < 10,
  down3: (s, t) =>
    t >= 3 &&
    s.close[t] < s.close[t - 1] &&
    s.close[t - 1] < s.close[t - 2] &&
    s.close[t - 2] < s.close[t - 3],
};
const rules = {};
for (const [name, rule] of Object.entries(base)) {
  rules[name] = rule;
  rules[`${name}+up`] = (s, t) => rule(s, t) && s.close[t] > s.sma200[t];
}

// Returns { j, price } for the exit of a position entered at the open of session i.
const exits = {
  'fixed-5': (s, i) => ({ j: i + 4, price: s.close[i + 4] }),
  'fixed-10': (s, i) => ({ j: i + 9, price: s.close[i + 9] }),
  'prior-high-10': (s, i) => {
    for (let k = i; k < i + 9; k++) {
      if (k + 1 >= s.close.length) return { j: k + 1, price: undefined };
      if (s.close[k] > s.high[k - 1]) return { j: k + 1, price: s.open[k + 1], atOpen: true };
    }
    return { j: i + 9, price: s.close[i + 9] };
  },
};

function run(s, rule, exit) {
  const trades = [];
  const n = s.close.length;
  let busyUntil = -1;
  for (let t = 200; t < n - 1; t++) {
    if (t + 1 <= busyUntil) continue;
    if (!rule(s, t)) continue;
    const i = t + 1;
    const out = exit(s, i);
    if (out.j >= n || !(out.price > 0)) continue;
    trades.push({
      entry: s.date[i],
      exit: s.date[out.j],
      i,
      j: out.j,
      atOpen: Boolean(out.atOpen),
      net: out.price / s.open[i] - 1 - COST,
      sessions: out.j - i + (out.atOpen ? 0 : 1),
    });
    // A position closed at an open frees that session for a new signal's entry.
    busyUntil = out.atOpen ? out.j - 1 : out.j;
  }
  return trades;
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
    const g = groups.get(t.entry.slice(0, 7)) ?? { sum: 0, n: 0 };
    g.sum += value(t);
    g.n++;
    groups.set(t.entry.slice(0, 7), g);
  }
  const list = [...groups.values()];
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
  return [means[49], means[1949]];
}

// Unconditional drift: mean open-to-open return per session over the period, used to price
// the market's own return for a holding of the same length.
function drift(s, from, to) {
  let sum = 0;
  let n = 0;
  for (let i = from; i < to; i++) {
    sum += Math.log(s.open[i + 1] / s.open[i]);
    n++;
  }
  return sum / n;
}
function windows(s, from, to, length) {
  let sum = 0;
  let wins = 0;
  let n = 0;
  for (let i = from; i + length - 1 <= to; i++) {
    const r = s.close[i + length - 1] / s.open[i] - 1 - COST;
    sum += r;
    if (r > 0) wins++;
    n++;
  }
  return { mean: sum / n, win: wins / n };
}

function account(s, trades, from, to) {
  // Daily closes of an account that holds the instrument only inside trades, cash otherwise.
  let equity = 1;
  let peak = 1;
  let drawdown = 0;
  let inMarket = 0;
  const byEntry = new Map(trades.map((t) => [t.i, t]));
  let open = null;
  const daily = [];
  for (let k = from; k <= to; k++) {
    let r = 0;
    if (open && open.atOpen && k === open.j) {
      r = s.open[k] / s.close[k - 1] - 1 - COST;
      open = null;
    }
    const starting = byEntry.get(k);
    if (starting) {
      open = starting;
      r = (1 + r) * (s.close[k] / s.open[k]) - 1;
      inMarket++;
    } else if (open) {
      r = s.close[k] / s.close[k - 1] - 1;
      inMarket++;
    }
    if (open && !open.atOpen && k === open.j) {
      r = (1 + r) * (1 - COST) - 1;
      open = null;
    }
    equity *= 1 + r;
    daily.push(r);
    peak = Math.max(peak, equity);
    drawdown = Math.max(drawdown, 1 - equity / peak);
  }
  const years = (to - from + 1) / 252;
  const avg = daily.reduce((a, b) => a + b, 0) / daily.length;
  const sd = Math.sqrt(daily.reduce((a, b) => a + (b - avg) ** 2, 0) / daily.length);
  return {
    cagr: equity ** (1 / years) - 1,
    drawdown,
    exposure: inMarket / (to - from + 1),
    sharpe: sd ? (avg / sd) * Math.sqrt(252) : 0,
  };
}
function hold(s, from, to) {
  let peak = 0;
  let drawdown = 0;
  const daily = [];
  for (let k = from; k <= to; k++) {
    peak = Math.max(peak, s.close[k]);
    drawdown = Math.max(drawdown, 1 - s.close[k] / peak);
    if (k > from) daily.push(s.close[k] / s.close[k - 1] - 1);
  }
  const avg = daily.reduce((a, b) => a + b, 0) / daily.length;
  const sd = Math.sqrt(daily.reduce((a, b) => a + (b - avg) ** 2, 0) / daily.length);
  return {
    cagr: (s.close[to] / s.close[from]) ** (252 / (to - from)) - 1,
    drawdown,
    sharpe: (avg / sd) * Math.sqrt(252),
  };
}

const pct = (x, d = 2) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}%`;
function report(label, s, trades, from, to, exitName) {
  if (!trades.length) return console.log(`${label.padEnd(34)} no trades`);
  const mean = trades.reduce((a, t) => a + t.net, 0) / trades.length;
  const win = trades.filter((t) => t.net > 0).length / trades.length;
  const sessions = trades.reduce((a, t) => a + t.sessions, 0) / trades.length;
  const perSession = drift(s, from, to);
  // Edge: trade return minus what the market's average drift pays for the same holding.
  const edge = (t) => t.net - (Math.exp(perSession * t.sessions) - 1 - COST);
  const edgeMean = trades.reduce((a, t) => a + edge(t), 0) / trades.length;
  const ci = interval(trades, edge);
  const acct = account(s, trades, from, to);
  const fixed = /^fixed-(\d+)$/.exec(exitName);
  const all = fixed ? windows(s, from, to, Number(fixed[1])) : null;
  console.log(
    [
      label.padEnd(34),
      `n=${String(trades.length).padStart(4)}`,
      `win ${(win * 100).toFixed(1)}%`,
      all ? `(all ${(all.win * 100).toFixed(1)}%)` : '',
      `mean ${pct(mean)}`,
      all ? `(all ${pct(all.mean)})` : '',
      `hold ${sessions.toFixed(1)}`,
      `| edge ${pct(edgeMean)} [${pct(ci[0])}, ${pct(ci[1])}]`,
      `| acct CAGR ${pct(acct.cagr, 1)} DD ${(acct.drawdown * 100).toFixed(0)}% exp ${(acct.exposure * 100).toFixed(0)}% Sh ${acct.sharpe.toFixed(2)}`,
    ].join('  ')
  );
}

const symbols = (args.symbols ?? 'SPY,QQQ').split(',');
const ruleIds = (args.rules ?? Object.keys(rules).join(',')).split(',');
const exitIds = (args.exits ?? Object.keys(exits).join(',')).split(',');
for (const symbol of symbols) {
  const s = loadSeries(symbol);
  const n = s.close.length;
  const split = s.date.findIndex((d) => d >= SPLIT);
  const devHold = hold(s, 200, split - 1);
  console.log(
    `\n${symbol} ${s.date[0]}..${s.date[n - 1]} | DEV buy&hold CAGR ${pct(devHold.cagr, 1)} DD ${(devHold.drawdown * 100).toFixed(0)}% Sh ${devHold.sharpe.toFixed(2)}`
  );
  for (const ruleId of ruleIds) {
    for (const exitId of exitIds) {
      const trades = run(s, rules[ruleId], exits[exitId]);
      const dev = trades.filter((t) => t.entry < SPLIT);
      report(`${ruleId}/${exitId} DEV`, s, dev, 200, split - 1, exitId);
      if (args.final === `${ruleId}/${exitId}`) {
        const test = trades.filter((t) => t.entry >= SPLIT);
        const testHold = hold(s, split, n - 1);
        console.log(
          `   TEST buy&hold CAGR ${pct(testHold.cagr, 1)} DD ${(testHold.drawdown * 100).toFixed(0)}% Sh ${testHold.sharpe.toFixed(2)}`
        );
        report(`   ${ruleId}/${exitId} TEST`, s, test, split, n - 1, exitId);
        for (const [a, b] of [
          ['2013', '2017'],
          ['2018', '2021'],
          ['2022', '2023'],
          ['2024', '2026'],
        ]) {
          const part = test.filter((t) => t.entry.slice(0, 4) >= a && t.entry.slice(0, 4) <= b);
          const f = s.date.findIndex((d) => d.slice(0, 4) >= a);
          let l = n - 1;
          while (s.date[l].slice(0, 4) > b) l--;
          report(`     ${a}-${b}`, s, part, f, l, exitId);
        }
      }
    }
  }
}
