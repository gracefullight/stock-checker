import fs from 'node:fs';
import { fetchYahooDaily } from '/Users/gracefullight/workspace/stock-checker/packages/core/src/services/yahoo-finance.ts';
for (const symbol of ['^GSPC', 'SPY', 'QQQ', 'SSO']) {
  const rows = await fetchYahooDaily(
    symbol,
    new Date('1949-01-01T00:00:00Z'),
    new Date('2026-11-27T00:00:00Z')
  );
  fs.writeFileSync(
    `/Users/gracefullight/workspace/stock-checker/data/strategy-validation/events-20261127/${symbol.replace('^', '')}.json`,
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
