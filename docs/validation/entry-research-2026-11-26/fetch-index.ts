// Fetches full adjusted daily history for index ETFs through the project's Yahoo client.
// Run from packages/core: bun ../../docs/validation/entry-research-2026-11-26/fetch-index.ts <dir> SPY QQQ ...
import fs from 'node:fs';
import { fetchYahooDaily } from '../../../packages/core/src/services/yahoo-finance.ts';

const out = process.argv[2];
for (const symbol of process.argv.slice(3)) {
  const rows = await fetchYahooDaily(
    symbol,
    new Date('1990-01-01T00:00:00Z'),
    new Date('2026-11-25T00:00:00Z')
  );
  const list = Array.isArray(rows) ? rows : (rows as { rows: unknown[] }).rows;
  fs.writeFileSync(`${out}/${symbol}.json`, JSON.stringify(list));
  const first = list[0] as { date: Date | string };
  const last = list.at(-1) as { date: Date | string };
  console.log(
    symbol,
    list.length,
    String(first.date),
    String(last.date),
    Object.keys(rows as object).slice(0, 8)
  );
}
