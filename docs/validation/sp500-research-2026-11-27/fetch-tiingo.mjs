// Downloads adjusted daily bars from Tiingo for the tickers in --list=<file> (one per line),
// or for every ticker that was an S&P 500 member on or after --since, plus SPY.
// Resumable: existing files are skipped. On the hourly limit it stops, or with --wait
// retries every 10 minutes until the allocation returns. --limit caps the downloads of one run.
// The token is read from TIINGO_API_KEY and sent as a header; it is never printed.
import fs from 'node:fs';

const DIR = process.env.SP500_DATA ?? 'data/strategy-validation/sp500-pit-20261127';
const since = process.argv.find((a) => a.startsWith('--since='))?.split('=')[1] ?? '2005-01-01';
const limit = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? 1e9);
const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];
const list = process.argv.find((a) => a.startsWith('--list='))?.split('=')[1];
const wait = process.argv.includes('--wait');
const token = process.env.TIINGO_API_KEY;
if (!token) throw new Error('TIINGO_API_KEY is not set');

const lines = fs.readFileSync(`${DIR}/membership.csv`, 'utf8').trim().split('\n').slice(1);
const lastSeen = new Map();
for (const line of lines) {
  const comma = line.indexOf(',');
  const date = line.slice(0, comma);
  for (const ticker of line
    .slice(comma + 1)
    .replaceAll('"', '')
    .split(',')) {
    if (ticker && date >= since) lastSeen.set(ticker.trim(), date);
  }
}
// Most recently seen first, so an interrupted run covers the later years completely.
const symbols = list
  ? fs
      .readFileSync(list, 'utf8')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
  : only
    ? only.split(',')
    : [
        'SPY',
        ...[...lastSeen]
          .sort((a, b) => b[1].localeCompare(a[1]) || a[0].localeCompare(b[0]))
          .map(([t]) => t),
      ];

let fetched = 0;
let empty = 0;
let failed = 0;
let waiting = false;
for (let index = 0; index < symbols.length; index++) {
  const symbol = symbols[index];
  if (fetched >= limit) break;
  const file = `${DIR}/prices/${symbol}.json`;
  if (fs.existsSync(file)) continue;
  const url = `https://api.tiingo.com/tiingo/daily/${encodeURIComponent(symbol.replace('.', '-'))}/prices?startDate=2003-01-01&endDate=2026-11-25&format=json`;
  const response = await fetch(url, {
    headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
  });
  if (response.status === 429) {
    const text = (await response.text()).slice(0, 160);
    if (!wait || !/hourly/i.test(text)) {
      console.log(`rate limited after ${fetched} downloads: ${text}`);
      break;
    }
    if (!waiting)
      console.log(
        `${new Date().toISOString()} hourly limit after ${fetched} downloads; retrying every 10 minutes`
      );
    waiting = true;
    await new Promise((resolve) => setTimeout(resolve, 10 * 60_000));
    index--;
    continue;
  }
  if (response.status === 404) {
    fs.writeFileSync(file, '[]');
    empty++;
    continue;
  }
  if (!response.ok) {
    const text = (await response.text()).slice(0, 160);
    console.log(`${symbol}: HTTP ${response.status} ${text}`);
    failed++;
    if (/limit|allocation|exceed/i.test(text)) break;
    continue;
  }
  waiting = false;
  const rows = await response.json();
  // [date, adjOpen, adjHigh, adjLow, adjClose, rawClose, rawVolume]
  const compact = Array.isArray(rows)
    ? rows
        .filter((r) => r.adjClose > 0 && r.adjOpen > 0)
        .map((r) => [
          r.date.slice(0, 10),
          r.adjOpen,
          r.adjHigh,
          r.adjLow,
          r.adjClose,
          r.close,
          r.volume,
        ])
    : [];
  fs.writeFileSync(file, JSON.stringify(compact));
  if (!compact.length) empty++;
  fetched++;
  if (fetched % 50 === 0)
    console.log(`${fetched} downloaded, last ${symbol} (${compact.length} bars)`);
}
const files = fs.readdirSync(`${DIR}/prices`).length;
console.log(
  `done: ${fetched} downloaded this run, ${empty} empty, ${failed} failed, ${files} of ${symbols.length} symbols on disk`
);
