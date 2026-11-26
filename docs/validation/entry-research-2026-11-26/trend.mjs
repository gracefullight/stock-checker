// Trend-gated index exposure, with and without 2x leverage, on actual ETF prices.
//
// REGISTERED before any result was read:
//   - Rule (Gayed & Bilello 2016, unchanged): after a session where the index ETF closes
//     above its 200-session simple average, hold from the next open; after a close at or
//     below it, leave at the next open and hold cash (0% interest).
//   - Vehicles: 1x = SPY / QQQ themselves; 2x = SSO / QLD (actual prices, so fees,
//     financing and volatility drag are included). Signal always from the 1x index ETF.
//   - Returns are open to open; each switch costs 5 bps (10 bps per round trip).
//   - DEV = 2006-07-01 .. 2015-12-31 (the paper's own data ended in 2015).
//     TEST = 2016-01-01 .. 2026-11-24, printed only with --final.
//   - Pass, both required on TEST for a vehicle: CAGR above buy-and-hold of the 1x index,
//     and Sharpe ratio (daily, 0% risk-free) not below it. Maximum drawdown is reported.
//   - A vehicle that fails the same two conditions on DEV is not run on TEST.
import fs from 'node:fs';

const DIR = `${process.env.INDEX_DATA ?? 'data/strategy-validation/index-etfs-20261126'}/`;
const final = process.argv.includes('--final');
const SWITCH_COST = 0.0005;

function load(symbol) {
  const rows = JSON.parse(fs.readFileSync(`${DIR}${symbol}.json`, 'utf8'));
  return {
    date: rows.map((b) => String(b.date).slice(0, 10)),
    open: rows.map((b) => b.open),
    close: rows.map((b) => b.close),
  };
}

function stats(daily) {
  let equity = 1;
  let peak = 1;
  let drawdown = 0;
  let sum = 0;
  let squares = 0;
  for (const r of daily) {
    equity *= 1 + r;
    peak = Math.max(peak, equity);
    drawdown = Math.max(drawdown, 1 - equity / peak);
    sum += r;
    squares += r * r;
  }
  const mean = sum / daily.length;
  const deviation = Math.sqrt(squares / daily.length - mean * mean);
  return {
    cagr: equity ** (252 / daily.length) - 1,
    drawdown,
    sharpe: (mean / deviation) * Math.sqrt(252),
    total: equity - 1,
  };
}

const line = (label, s) =>
  `${label.padEnd(30)} CAGR ${(s.cagr * 100).toFixed(1).padStart(5)}%  maxDD ${(s.drawdown * 100).toFixed(0).padStart(3)}%  Sharpe ${s.sharpe.toFixed(2)}  total ${(s.total * 100).toFixed(0)}%`;

for (const [indexSymbol, leveraged] of [
  ['SPY', 'SSO'],
  ['QQQ', 'QLD'],
]) {
  const index = load(indexSymbol);
  const twice = load(leveraged);
  const twiceAt = new Map(twice.date.map((d, i) => [d, i]));
  const n = index.close.length;
  const average = new Array(n).fill(Number.NaN);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += index.close[i];
    if (i >= 200) sum -= index.close[i - 200];
    if (i >= 199) average[i] = sum / 200;
  }

  // One row per session k: the position decided on the close of k-1 is held from the
  // open of k to the open of k+1.
  const sessions = [];
  let inMarket = null;
  for (let k = 1; k + 1 < n; k++) {
    const a = twiceAt.get(index.date[k]);
    const b = twiceAt.get(index.date[k + 1]);
    if (a === undefined || b === undefined) continue;
    const want = index.close[k - 1] > average[k - 1];
    const switched = inMarket !== null && want !== inMarket;
    inMarket = want;
    sessions.push({
      date: index.date[k],
      once: index.open[k + 1] / index.open[k] - 1,
      twice: twice.open[b] / twice.open[a] - 1,
      want,
      cost: switched ? SWITCH_COST : 0,
    });
  }

  const periods = [['DEV', '2006-07-01', '2015-12-31']];
  if (final) periods.push(['TEST', '2016-01-01', '2026-11-24']);
  for (const [name, from, to] of periods) {
    const rows = sessions.filter((s) => s.date >= from && s.date <= to);
    const held = rows.filter((s) => s.want).length;
    const switches = rows.filter((s) => s.cost > 0).length;
    console.log(
      `\n${indexSymbol} ${name} ${from}..${to}  (${rows.length} sessions, in market ${((held / rows.length) * 100).toFixed(0)}%, ${switches} switches)`
    );
    console.log(line(`  ${indexSymbol} buy and hold`, stats(rows.map((s) => s.once))));
    console.log(line(`  ${leveraged} buy and hold (2x)`, stats(rows.map((s) => s.twice))));
    console.log(
      line(
        `  ${indexSymbol} above 200d, else cash`,
        stats(rows.map((s) => (s.want ? s.once : 0) - s.cost))
      )
    );
    console.log(
      line(
        `  ${leveraged} above 200d, else cash`,
        stats(rows.map((s) => (s.want ? s.twice : 0) - s.cost))
      )
    );
  }
}
