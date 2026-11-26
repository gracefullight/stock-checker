// Downloads adjusted daily bars from Yahoo for every ticker that was an S&P 500 member on or
// after --since. Yahoo keeps listed tickers only; names it cannot serve are left for Tiingo.
// Run from packages/core: bun ../../docs/validation/sp500-research-2026-11-27/fetch-yahoo.ts
import fs from 'node:fs';
import { fetchYahooDaily } from '../../../packages/core/src/services/yahoo-finance.ts';

const DIR = process.env.SP500_DATA ?? '../../data/strategy-validation/sp500-pit-20261127';
const since = process.argv.find((a) => a.startsWith('--since='))?.split('=')[1] ?? '2005-01-01';
fs.mkdirSync(`${DIR}/prices-yahoo`, { recursive: true });
const seen = new Set<string>();
for (const line of fs.readFileSync(`${DIR}/membership.csv`, 'utf8').trim().split('\n').slice(1)) {
  const comma = line.indexOf(',');
  if (line.slice(0, comma) < since) continue;
  for (const ticker of line
    .slice(comma + 1)
    .replaceAll('"', '')
    .split(','))
    if (ticker.trim()) seen.add(ticker.trim());
}
let fetched = 0;
let empty = 0;
let streak = 0;
for (const symbol of ['SPY', ...[...seen].sort()]) {
  const file = `${DIR}/prices-yahoo/${symbol}.json`;
  if (fs.existsSync(file)) continue;
  let rows: Awaited<ReturnType<typeof fetchYahooDaily>> = [];
  let missing = false;
  try {
    rows = await fetchYahooDaily(
      symbol.replace('.', '-'),
      new Date('2003-01-01T00:00:00Z'),
      new Date('2026-11-26T00:00:00Z')
    );
    streak = 0;
  } catch (error) {
    const message = String((error as Error).message ?? error);
    // Yahoo answers some delisted or re-listed tickers with rows its client rejects.
    missing = /No data found|delisted|Not Found|404|symbol may be|Schema validation/i.test(message);
    if (!missing) {
      streak++;
      console.log(`${symbol}: ${message.slice(0, 120)}`);
      // Consecutive unexplained failures mean throttling, not a missing ticker.
      if (streak >= 8) break;
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      continue;
    }
  }
  fs.writeFileSync(
    file,
    JSON.stringify(
      rows.map((r) => [
        new Date(r.date).toISOString().slice(0, 10),
        r.open,
        r.high,
        r.low,
        r.close,
        null,
        r.volume,
      ])
    )
  );
  if (!rows.length) empty++;
  fetched++;
  if (fetched % 100 === 0) console.log(`${fetched} written, last ${symbol} (${rows.length} bars)`);
  await new Promise((resolve) => setTimeout(resolve, 250));
}
console.log(
  `done: ${fetched} written this run (${empty} without data), ${fs.readdirSync(`${DIR}/prices-yahoo`).length} files on disk`
);
