// Decomposes the shipped strategy's 157 replayed trades: stock selection vs market timing.
import fs from 'node:fs';
import { COST, N, dates, ewReturn, pct, spy, summarize } from './harness.mjs';

const report = JSON.parse(
  fs.readFileSync('data/strategy-validation/leader-pullback-20261125.json', 'utf8')
);
const index = new Map(dates.map((d, i) => [d, i]));
const trades = report.executedTrades.map((t) => {
  const i = index.get(t.entryDate);
  const j = index.get(t.exitDate);
  return {
    symbol: t.ticker,
    entry: t.entryDate,
    exit: t.exitDate,
    entryIdx: i,
    exitIdx: j,
    net: t.returnPct / 100,
    spyNet: spy.close[j] / spy.open[i] - 1 - COST,
    ewNet: ewReturn(i, j),
  };
});
console.log(summarize('shipped ALL', trades));
console.log(
  summarize(
    'shipped <2024',
    trades.filter((t) => t.entry < '2024-01-01')
  )
);
console.log(
  summarize(
    'shipped 2024+',
    trades.filter((t) => t.entry >= '2024-01-01')
  )
);

// Unconditional SPY and equal-weight five-session windows over the same span.
const first = Math.min(...trades.map((t) => t.entryIdx));
let spySum = 0;
let ewSum = 0;
let spyWin = 0;
let n = 0;
for (let i = first; i + 4 < N; i++) {
  const r = spy.close[i + 4] / spy.open[i] - 1 - COST;
  spySum += r;
  if (r > 0) spyWin++;
  ewSum += ewReturn(i, i + 4);
  n++;
}
console.log(
  `every 5-session window since ${dates[first]}: SPY ${pct(spySum / n)} (win ${((spyWin / n) * 100).toFixed(1)}%), equal-weight universe ${pct(ewSum / n)}, n=${n}`
);
