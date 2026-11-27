// Extracts open-market insider purchases from the SEC "Insider Transactions Data Sets"
// (quarterly Form 3/4/5 zips) into one CSV.
// Usage: node insider-extract.mjs <directory of YYYYqN.zip files>
// Kept: Form 4 (not amendments), non-derivative, transaction code P, acquired, with a
// positive share count and price. One row per transaction line and reporting owner.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const source = process.argv[2];
const OUT = `${process.env.INSIDER_DATA ?? 'data/strategy-validation/sec-insider-20261127'}/purchases.csv`;
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
// Free-text columns can hold line breaks, so a record is a line that starts with an
// accession number; anything else is the tail of a text field and is ignored.
function records(zip, name) {
  const text = execFileSync('unzip', ['-p', zip, name], { maxBuffer: 1 << 30 }).toString('utf8');
  const lines = text.split('\n');
  const header = lines[0].trim().split('\t');
  const rows = [];
  for (const line of lines) if (/^\d{10}-\d{2}-\d{6}\t/.test(line)) rows.push(line.split('\t'));
  return { header, rows };
}

const out = ['filingDate,transDate,ticker,issuerCik,ownerCik,relationship,shares,price'];
let kept = 0;
for (const file of fs
  .readdirSync(source)
  .filter((f) => /^\d{4}q\d\.zip$/.test(f))
  .sort()) {
  const zip = `${source}/${file}`;
  const submission = records(zip, 'SUBMISSION.tsv');
  const col = (table, name) => table.header.indexOf(name);
  const filings = new Map();
  for (const row of submission.rows) {
    if (row[col(submission, 'DOCUMENT_TYPE')] !== '4') continue;
    filings.set(row[0], {
      filed: iso(row[col(submission, 'FILING_DATE')]),
      cik: row[col(submission, 'ISSUERCIK')],
      ticker: (row[col(submission, 'ISSUERTRADINGSYMBOL')] ?? '')
        .trim()
        .toUpperCase()
        .replace(/[",]/g, ' ')
        .trim(),
    });
  }
  const owners = new Map();
  const owner = records(zip, 'REPORTINGOWNER.tsv');
  for (const row of owner.rows) {
    if (!filings.has(row[0])) continue;
    if (!owners.has(row[0])) owners.set(row[0], []);
    owners
      .get(row[0])
      .push({
        cik: row[col(owner, 'RPTOWNERCIK')],
        relationship: row[col(owner, 'RPTOWNER_RELATIONSHIP')] ?? '',
      });
  }
  const trans = records(zip, 'NONDERIV_TRANS.tsv');
  let quarter = 0;
  for (const row of trans.rows) {
    const filing = filings.get(row[0]);
    if (
      !filing ||
      row[col(trans, 'TRANS_CODE')] !== 'P' ||
      row[col(trans, 'TRANS_ACQUIRED_DISP_CD')] !== 'A'
    )
      continue;
    const shares = Number(row[col(trans, 'TRANS_SHARES')]);
    const price = Number(row[col(trans, 'TRANS_PRICEPERSHARE')]);
    if (!(shares > 0) || !(price > 0) || !filing.filed || !filing.ticker) continue;
    for (const who of owners.get(row[0]) ?? []) {
      out.push(
        [
          filing.filed,
          iso(row[col(trans, 'TRANS_DATE')]),
          filing.ticker,
          filing.cik,
          who.cik,
          who.relationship.replaceAll(',', '|'),
          shares,
          price,
        ].join(',')
      );
      quarter++;
    }
  }
  kept += quarter;
  console.log(`${file}: ${filings.size} Form 4 filings, ${quarter} purchase rows`);
}
fs.writeFileSync(OUT, `${out.join('\n')}\n`);
console.log(`wrote ${kept} rows to ${OUT}`);
