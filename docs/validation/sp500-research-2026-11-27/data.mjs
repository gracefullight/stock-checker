// Shared loaders for the point-in-time S&P 500 dataset.
import fs from 'node:fs';

export const DIR = process.env.SP500_DATA ?? 'data/strategy-validation/sp500-pit-20261127';
export const SINCE = '2005-01-01';

/** Membership snapshots: the list in force on a date is the latest row at or before it. */
export const snapshots = fs
  .readFileSync(`${DIR}/membership.csv`, 'utf8')
  .trim()
  .split('\n')
  .slice(1)
  .map((line) => {
    const comma = line.indexOf(',');
    return {
      date: line.slice(0, comma),
      tickers: line
        .slice(comma + 1)
        .replaceAll('"', '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    };
  });

/** Session calendar from SPY (Yahoo). */
export const spyRows = JSON.parse(fs.readFileSync(`${DIR}/prices-yahoo/SPY.json`, 'utf8'));
export const dates = spyRows.map((r) => r[0]);

export function membersBySession(sessions) {
  const out = [];
  let cursor = 0;
  for (const date of sessions) {
    while (cursor + 1 < snapshots.length && snapshots[cursor + 1].date <= date) cursor++;
    out.push(snapshots[cursor].tickers);
  }
  return out;
}

/** ticker -> sessions (from SINCE) on which it was an index member. */
export function memberDays() {
  const sessions = dates.filter((d) => d >= SINCE);
  const lists = membersBySession(sessions);
  const days = new Map();
  sessions.forEach((date, i) => {
    for (const ticker of lists[i]) {
      if (!days.has(ticker)) days.set(ticker, []);
      days.get(ticker).push(date);
    }
  });
  return days;
}

export function readBars(source, ticker) {
  const file = `${DIR}/${source === 'tiingo' ? 'prices' : 'prices-yahoo'}/${ticker}.json`;
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

export const renames = fs.existsSync(`${DIR}/renames.json`)
  ? JSON.parse(fs.readFileSync(`${DIR}/renames.json`, 'utf8'))
  : {};

/**
 * The bars that price the most of a ticker's member-days: its own symbol or the symbol it
 * was renamed to, from either source. Returns { rows, priced, symbol, source } or null.
 */
export function bestBars(ticker, days) {
  let best = null;
  const symbols =
    renames[ticker] && renames[ticker] !== ticker ? [ticker, renames[ticker]] : [ticker];
  for (const symbol of symbols) {
    for (const source of ['yahoo', 'tiingo']) {
      const rows = readBars(source, symbol);
      if (!rows?.length) continue;
      const have = new Set(rows.map((r) => r[0]));
      const priced = days.filter((d) => have.has(d)).length;
      if (priced > (best?.priced ?? 0)) best = { rows, priced, symbol, source };
    }
  }
  return best;
}

/** Tiingo's supported US stock listings: symbol -> [{ start, end }]. */
export function tiingoListings() {
  const listings = new Map();
  for (const line of fs
    .readFileSync(`${DIR}/tiingo-supported.csv`, 'utf8')
    .trim()
    .split('\n')
    .slice(1)) {
    const [ticker, , type, currency, start, end] = line.split(',');
    if (type !== 'Stock' || currency !== 'USD' || !start) continue;
    const key = ticker.toUpperCase();
    if (!listings.has(key)) listings.set(key, []);
    listings.get(key).push({ start, end });
  }
  return listings;
}
export const tiingoSymbol = (ticker) => ticker.replace('.', '-');
