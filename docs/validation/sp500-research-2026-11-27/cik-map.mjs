// Maps each S&P 500 member ticker to SEC CIKs, point-in-time, from the issuer symbol that
// filers typed on Form 3/4/5 submissions (SEC Insider Transactions Data Sets).
// Usage: node cik-map.mjs <directory of YYYYqN.zip files>
// Output: cik-map.json  { ticker: [{ cik, first, last, filings }] }, most filings first.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { memberDays } from './data.mjs';

const source = process.argv[2];
const OUT = `${process.env.INSIDER_DATA ?? 'data/strategy-validation/sec-insider-20261127'}/cik-map.json`;
const MONTHS = {
  JAN: '01',
  FEB: '02',
  MAR: '03',
  APR: '04',
  MAY: '05',
  JUN: '06',
  JUL: '07',
  AUG: '08',
  SEP: '09',
  OCT: '10',
  NOV: '11',
  DEC: '12',
};
const iso = (d) => {
  const m = /^(\d{2})-([A-Z]{3})-(\d{4})$/.exec(d ?? '');
  return m ? `${m[3]}-${MONTHS[m[2]]}-${m[1]}` : '';
};
const days = memberDays();
const pairs = new Map();
for (const file of fs
  .readdirSync(source)
  .filter((f) => /^\d{4}q\d\.zip$/.test(f))
  .sort()) {
  const text = execFileSync('unzip', ['-p', `${source}/${file}`, 'SUBMISSION.tsv'], {
    maxBuffer: 1 << 30,
  }).toString('utf8');
  const lines = text.split('\n');
  const header = lines[0].trim().split('\t');
  const [dateAt, cikAt, tickerAt] = ['FILING_DATE', 'ISSUERCIK', 'ISSUERTRADINGSYMBOL'].map((n) =>
    header.indexOf(n)
  );
  for (const line of lines) {
    if (!/^\d{10}-\d{2}-\d{6}\t/.test(line)) continue;
    const row = line.split('\t');
    const filed = iso(row[dateAt]);
    // Only a field that is exactly one symbol counts: free text such as "N/A" or
    // "CLASS A" would otherwise be read as the tickers A, N or K.
    const field = (row[tickerAt] ?? '')
      .trim()
      .toUpperCase()
      .replace(/"/g, '')
      .replace(/^(NYSE|NASDAQ|NYSE ARCA|AMEX)\s*:\s*/, '')
      .replace('-', '.')
      .replace('/', '.');
    for (const ticker of /^[A-Z]{1,5}(\.[A-Z])?$/.test(field) ? [field] : []) {
      if (!days.has(ticker)) continue;
      const key = `${ticker}|${row[cikAt]}`;
      const pair = pairs.get(key) ?? {
        ticker,
        cik: row[cikAt],
        first: filed,
        last: filed,
        filings: 0,
      };
      if (filed < pair.first) pair.first = filed;
      if (filed > pair.last) pair.last = filed;
      pair.filings++;
      pairs.set(key, pair);
    }
  }
}
// Keep a CIK for a ticker only when its filings fall inside the ticker's membership span
// (within a year either side) and it is not a stray typo: at least twenty filings.
const map = {};
let mapped = 0;
for (const [ticker, memberDates] of days) {
  const from = new Date(Date.parse(memberDates[0]) - 365 * 86_400_000).toISOString().slice(0, 10);
  const to = new Date(Date.parse(memberDates.at(-1)) + 365 * 86_400_000).toISOString().slice(0, 10);
  const rows = [...pairs.values()]
    .filter((p) => p.ticker === ticker && p.last >= from && p.first <= to && p.filings >= 20)
    .sort((a, b) => b.filings - a.filings)
    .map(({ cik, first, last, filings }) => ({ cik, first, last, filings }));
  if (rows.length) {
    map[ticker] = rows;
    mapped++;
  }
}
fs.writeFileSync(OUT, `${JSON.stringify(map)}\n`);
const ciks = new Set(Object.values(map).flatMap((rows) => rows.map((r) => r.cik)));
console.log(
  `member tickers ${days.size}; mapped to a CIK ${mapped}; distinct CIKs ${ciks.size}; tickers with more than one CIK ${Object.values(map).filter((r) => r.length > 1).length}`
);
