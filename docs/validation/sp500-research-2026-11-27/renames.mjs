// Finds ticker renames among S&P 500 members, so that a member listed under an old symbol
// is priced from its current symbol's history.
//
// Evidence: Wikipedia's constituent table gives each current member's "Date added" to the
// index. When that date is earlier than the first snapshot on which the symbol appears, the
// company was already a member under another symbol, and a symbol that disappears from the
// snapshots on that same date is its predecessor. Chains (A -> B -> C) are followed.
//
// A disappearing symbol is not a predecessor when it kept trading (Yahoo bars more than ten
// days after the date) or was delisted in its own right (a Tiingo listing that reaches the
// date). If the date still has more than one candidate it is left unmapped, except for the
// two well-known same-day pairs in MANUAL.
import fs from 'node:fs';
import { DIR, readBars, SINCE, snapshots, tiingoListings, tiingoSymbol } from './data.mjs';

// 2019-11-05: Symantec became NortonLifeLock (now Gen Digital) and HCP became Healthpeak.
const MANUAL = { SYMC: 'NLOK', HCP: 'PEAK' };

const wiki = fs.readFileSync(`${DIR}/wikipedia-constituents.wiki`, 'utf8');
const added = new Map();
for (const block of wiki.split('\n|-\n')) {
  const symbol = /\{\{(?:Nyse|Nasdaq|Cboe|Bats)[A-Za-z]*\|([A-Z.]+)\}\}/.exec(block)?.[1];
  const date = /\|\|\s*(\d{4}-\d{2}-\d{2})/.exec(block)?.[1];
  if (symbol && date) added.set(symbol, date);
}

const sets = snapshots.map((s) => ({ date: s.date, tickers: new Set(s.tickers) }));
const listings = tiingoListings();
const days = (a, b) => (Date.parse(a) - Date.parse(b)) / 86_400_000;
const shift = (date, n) => new Date(Date.parse(date) + n * 86_400_000).toISOString().slice(0, 10);

function stintStart(ticker, until) {
  let i = until;
  while (i > 0 && sets[i - 1].tickers.has(ticker)) i--;
  return i;
}
function separateCompany(ticker, date) {
  const yahoo = readBars('yahoo', ticker);
  if (yahoo?.length && yahoo.at(-1)[0] > shift(date, 10)) return true;
  const rows = listings.get(tiingoSymbol(ticker)) ?? listings.get(ticker) ?? [];
  return rows.some((r) => r.start < date && r.end >= shift(date, -45));
}

const renames = {};
const unmapped = [];
const last = sets.length - 1;
for (const [current, joined] of added) {
  if (!sets[last].tickers.has(current)) continue;
  let symbol = current;
  let index = stintStart(symbol, last);
  // Early snapshots are weeks apart, so allow 45 days between the two dates.
  while (index > 0 && days(sets[index].date, joined) > 45) {
    const date = sets[index].date;
    const gone = [...sets[index - 1].tickers].filter((t) => !sets[index].tickers.has(t));
    let candidates = gone.filter((t) => !renames[t] && !separateCompany(t, date));
    const manual = candidates.filter((t) => MANUAL[t] === symbol);
    if (manual.length === 1) candidates = manual;
    if (candidates.length !== 1) {
      if (candidates.length > 1) unmapped.push(`${symbol}@${date}: ${candidates.join('/')}`);
      break;
    }
    const previous = candidates[0];
    // Earlier renames concern members that left before the dataset starts.
    if (date < SINCE) break;
    renames[previous] = current;
    symbol = previous;
    index = stintStart(previous, index - 1);
  }
}
fs.writeFileSync(`${DIR}/renames.json`, `${JSON.stringify(renames, null, 1)}\n`);
console.log(
  `current members with a date added: ${added.size}; renames mapped: ${Object.keys(renames).length}; ambiguous dates left unmapped: ${unmapped.length}`
);
console.log(
  Object.entries(renames)
    .map(([a, b]) => `${a}>${b}`)
    .join(' ')
);
if (unmapped.length) console.log(`unmapped: ${unmapped.join('; ')}`);
