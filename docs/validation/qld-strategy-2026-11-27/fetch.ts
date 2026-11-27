// Downloads adjusted daily history for the QLD study through the project's Yahoo client.
// Run from packages/core: bun ../../docs/validation/qld-strategy-2026-11-27/fetch.ts
import fs from 'node:fs';
import { fetchYahooDaily } from '../../../packages/core/src/services/yahoo-finance.ts';

const DIR = process.env.QLD_DATA ?? '../../data/strategy-validation/qld-20261127';
for (const symbol of ['QQQ', 'QLD', 'SPY', '^IRX']) {
  const rows = await fetchYahooDaily(
    symbol,
    new Date('1999-01-01T00:00:00Z'),
    new Date('2026-11-27T00:00:00Z')
  );
  fs.writeFileSync(
    `${DIR}/${symbol.replace('^', '')}.json`,
    JSON.stringify(
      rows.map((r) => [new Date(r.date).toISOString().slice(0, 10), r.open, r.high, r.low, r.close])
    )
  );
  console.log(
    symbol,
    rows.length,
    new Date(rows[0].date).toISOString().slice(0, 10),
    new Date(rows.at(-1)!.date).toISOString().slice(0, 10)
  );
}
