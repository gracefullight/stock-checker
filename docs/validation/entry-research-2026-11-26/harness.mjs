// Entry-hypothesis research harness over the frozen 2026-11-25 validation inputs.
//
// PROTOCOL (fixed before any result was read):
//   - Data: data/strategy-validation/leader-pullback-20261125-inputs (adjusted OHLCV).
//   - Execution: enter next session open after the signal close, exit at the close of the
//     Nth session counting the entry as session one, 10 bps round trip, one open position
//     per ticker. Same convention as strategy:validate.
//   - DEV = entries through 2023-12-31. TEST = entries from 2024-01-01.
//     TEST is printed only with --final=<id>; hypotheses are chosen on DEV alone.
//   - Benchmarks over the same entry-open to exit-close window, same cost:
//       SPY, and the equal-weight universe (shares the survivorship bias of the tickers).
//   - Interval: bootstrap that resamples entry months (2,000 resamples, seed 20261126),
//     because trades opened in the same weeks share one market window.
//   - A hypothesis passes when mean excess over SPY and over the equal-weight universe are
//     both positive with a 95% interval above zero on DEV, and again on TEST.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.env.DATASET ?? 'data/strategy-validation/leader-pullback-20261125-inputs';
const COST = 0.001;
const SPLIT = '2024-01-01';
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const load = (s) => JSON.parse(fs.readFileSync(path.join(ROOT, `${s}.json`), 'utf8'));
const spyRaw = load('SPY');
const dates = spyRaw.map((b) => b.date.slice(0, 10));
const dateIndex = new Map(dates.map((d, i) => [d, i]));
const N = dates.length;

function align(rows) {
  const s = {
    open: new Float64Array(N).fill(Number.NaN),
    high: new Float64Array(N).fill(Number.NaN),
    low: new Float64Array(N).fill(Number.NaN),
    close: new Float64Array(N).fill(Number.NaN),
    volume: new Float64Array(N).fill(Number.NaN),
    dollar: new Float64Array(N).fill(Number.NaN),
  };
  for (const b of rows) {
    const i = dateIndex.get(b.date.slice(0, 10));
    if (i === undefined) continue;
    s.open[i] = b.open;
    s.high[i] = b.high;
    s.low[i] = b.low;
    s.close[i] = b.close;
    s.volume[i] = b.volume;
    s.dollar[i] = b.dollarVolume ?? b.close * b.volume;
  }
  return s;
}

const spy = align(spyRaw);
const tickers = [];
const series = new Map();
for (const symbol of Object.keys(manifest.universe)) {
  const file = path.join(ROOT, `${symbol}.json`);
  if (!fs.existsSync(file)) continue;
  const s = align(load(symbol));
  let bars = 0;
  for (let i = 0; i < N; i++) if (Number.isFinite(s.close[i])) bars++;
  if (bars < 260) continue;
  tickers.push(symbol);
  series.set(symbol, s);
}

// ── helpers ────────────────────────────────────────────────────────────────
const ok = (x) => Number.isFinite(x) && x > 0;
function mean(a, from, to) {
  let sum = 0;
  let n = 0;
  for (let i = from; i <= to; i++) {
    if (!Number.isFinite(a[i])) return Number.NaN;
    sum += a[i];
    n++;
  }
  return n ? sum / n : Number.NaN;
}
function maxOf(a, from, to) {
  let m = -Infinity;
  for (let i = from; i <= to; i++) {
    if (!Number.isFinite(a[i])) return Number.NaN;
    if (a[i] > m) m = a[i];
  }
  return m;
}
function liquid(s, t) {
  return s.close[t] >= 5 && mean(s.dollar, t - 20, t - 1) >= 30e6;
}

const ewCache = new Map();
function ewReturn(i, j) {
  const key = i * 4096 + j;
  let v = ewCache.get(key);
  if (v !== undefined) return v;
  let sum = 0;
  let n = 0;
  for (const s of series.values()) {
    if (ok(s.open[i]) && ok(s.close[j])) {
      sum += s.close[j] / s.open[i] - 1;
      n++;
    }
  }
  v = n ? sum / n - COST : Number.NaN;
  ewCache.set(key, v);
  return v;
}

// ── hypotheses: (series, t) => boolean, evaluated on data up to and including t ──
const daily = {
  // H1: a large advance on heavy volume that closes strong (earnings-type reaction), then drift.
  'gap-drift': (s, t) => {
    if (t < 210 || !ok(s.close[t - 1]) || !ok(s.close[t])) return false;
    const ret = s.close[t] / s.close[t - 1] - 1;
    const avgVolume = mean(s.volume, t - 50, t - 1);
    return (
      ret >= 0.05 &&
      s.volume[t] >= 3 * avgVolume &&
      s.close[t] >= (s.high[t] + s.low[t]) / 2 &&
      liquid(s, t)
    );
  },
  // H2: a 252-session closing high out of a base of at least 20 sessions, on expanding volume.
  'high-breakout': (s, t) => {
    if (t < 260 || !ok(s.close[t])) return false;
    const oldHigh = maxOf(s.close, t - 252, t - 21);
    const baseHigh = maxOf(s.close, t - 20, t - 1);
    if (!Number.isFinite(oldHigh) || !Number.isFinite(baseHigh)) return false;
    const avgVolume = mean(s.volume, t - 50, t - 1);
    return (
      baseHigh < oldHigh && s.close[t] > oldHigh && s.volume[t] >= 1.5 * avgVolume && liquid(s, t)
    );
  },
};

function tradesFor(id, hold) {
  const out = [];
  if (id === 'momentum-12-1') {
    // H3: last session of each month, top decile by the return from t-252 to t-21.
    for (let t = 260; t < N - 1; t++) {
      if (dates[t].slice(0, 7) === dates[t + 1].slice(0, 7)) continue;
      const ranked = [];
      for (const symbol of tickers) {
        const s = series.get(symbol);
        if (!ok(s.close[t - 252]) || !ok(s.close[t - 21]) || !ok(s.close[t]) || !liquid(s, t))
          continue;
        ranked.push([symbol, s.close[t - 21] / s.close[t - 252] - 1]);
      }
      ranked.sort((a, b) => b[1] - a[1]);
      for (const [symbol] of ranked.slice(0, Math.floor(ranked.length / 10))) {
        const trade = settle(symbol, t, hold);
        if (trade) out.push(trade);
      }
    }
    return out;
  }
  const rule = daily[id];
  for (const symbol of tickers) {
    const s = series.get(symbol);
    let busyUntil = -1;
    for (let t = 0; t < N - 1; t++) {
      if (t + 1 <= busyUntil) continue;
      if (!rule(s, t)) continue;
      const trade = settle(symbol, t, hold);
      if (!trade) continue;
      busyUntil = trade.exitIdx;
      out.push(trade);
    }
  }
  return out;
}

function settle(symbol, t, hold) {
  const s = series.get(symbol);
  const i = t + 1;
  const j = i + hold - 1;
  if (j >= N || !ok(s.open[i]) || !ok(s.close[j])) return null;
  const net = s.close[j] / s.open[i] - 1 - COST;
  const spyNet = spy.close[j] / spy.open[i] - 1 - COST;
  return {
    symbol,
    entry: dates[i],
    exit: dates[j],
    entryIdx: i,
    exitIdx: j,
    net,
    spyNet,
    ewNet: ewReturn(i, j),
  };
}

// ── statistics ────────────────────────────────────────────────────────────
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
function clusterInterval(trades, value) {
  const groups = new Map();
  for (const t of trades) {
    const key = t.entry.slice(0, 7);
    const g = groups.get(key) ?? { sum: 0, n: 0 };
    g.sum += value(t);
    g.n++;
    groups.set(key, g);
  }
  const list = [...groups.values()];
  if (list.length < 2) return [Number.NaN, Number.NaN];
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
const pct = (x, d = 2) =>
  Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}%` : 'n/a';
function summarize(label, trades) {
  if (!trades.length) return `${label.padEnd(26)} no trades`;
  const avg = (f) => trades.reduce((a, t) => a + f(t), 0) / trades.length;
  const wins = trades.filter((t) => t.net > 0).length / trades.length;
  const spyWins = trades.filter((t) => t.spyNet > 0).length / trades.length;
  const beat = trades.filter((t) => t.net > t.spyNet).length / trades.length;
  const exSpy = clusterInterval(trades, (t) => t.net - t.spyNet);
  const exEw = clusterInterval(trades, (t) => t.net - t.ewNet);
  return [
    label.padEnd(26),
    `n=${String(trades.length).padStart(5)}`,
    `win ${(wins * 100).toFixed(1)}%`,
    `(SPY ${(spyWins * 100).toFixed(1)}%)`,
    `mean ${pct(avg((t) => t.net))}`,
    `SPY ${pct(avg((t) => t.spyNet))}`,
    `EW ${pct(avg((t) => t.ewNet))}`,
    `| xSPY ${pct(avg((t) => t.net - t.spyNet))} [${pct(exSpy[0])}, ${pct(exSpy[1])}]`,
    `| xEW ${pct(avg((t) => t.net - t.ewNet))} [${pct(exEw[0])}, ${pct(exEw[1])}]`,
    `| beat ${(beat * 100).toFixed(1)}%`,
  ].join('  ');
}

export {
  COST,
  N,
  SPLIT,
  args,
  dates,
  ewReturn,
  series,
  settle,
  spy,
  summarize,
  tickers,
  tradesFor,
  pct,
  clusterInterval,
  liquid,
  mean,
  maxOf,
  ok,
};

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`universe ${tickers.length} tickers, sessions ${dates[0]}..${dates[N - 1]}`);
  const ids = (args.ids ?? 'gap-drift,high-breakout,momentum-12-1').split(',');
  const holds = (args.holds ?? '5,10,20,40,60').split(',').map(Number);
  const final = args.final;
  for (const id of ids) {
    for (const hold of id === 'momentum-12-1' ? [21] : holds) {
      const all = tradesFor(id, hold);
      const dev = all.filter((t) => t.entry < SPLIT);
      console.log(summarize(`${id}/${hold} DEV`, dev));
      if (args.years) {
        for (const year of [...new Set(dev.map((t) => t.entry.slice(0, 4)))].sort()) {
          console.log(
            '   ',
            summarize(
              `${year}`,
              dev.filter((t) => t.entry.startsWith(year))
            )
          );
        }
      }
      if (final === `${id}/${hold}`) {
        const test = all.filter((t) => t.entry >= SPLIT);
        console.log(summarize(`${id}/${hold} TEST`, test));
        for (const year of [...new Set(test.map((t) => t.entry.slice(0, 4)))].sort()) {
          console.log(
            '   ',
            summarize(
              `${year}`,
              test.filter((t) => t.entry.startsWith(year))
            )
          );
        }
      }
    }
  }
}
