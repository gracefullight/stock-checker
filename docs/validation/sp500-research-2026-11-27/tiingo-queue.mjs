// Lists S&P 500 members whose member-days are not priced by the bars on disk, most recent
// first. These are the delisted tickers that only Tiingo can price.
// A member-day is a session on which the ticker was in the index; a ticker that left and
// returned is judged only on the days it was a member.
import fs from 'node:fs';
import { DIR, bestBars, memberDays, readBars, tiingoListings, tiingoSymbol } from './data.mjs';

const listings = tiingoListings();
const queue = [];
const tally = { priced: 0, tried: 0, unlisted: 0, reused: 0 };
let totalDays = 0;
let pricedDays = 0;
let queuedDays = 0;
for (const [ticker, days] of memberDays()) {
  const best = bestBars(ticker, days)?.priced ?? 0;
  totalDays += days.length;
  pricedDays += best;
  if (best >= days.length * 0.95) {
    tally.priced++;
    continue;
  }
  if (readBars('tiingo', ticker) !== null) {
    tally.tried++;
    continue;
  }
  // A ticker Yahoo still serves today belongs to a later company; Tiingo returns that
  // same company, so the earlier member under this symbol cannot be priced by either.
  if ((readBars('yahoo', ticker)?.at(-1)?.[0] ?? '') >= '2026-11-01') {
    tally.reused++;
    continue;
  }
  const rows = listings.get(tiingoSymbol(ticker)) ?? listings.get(ticker) ?? [];
  if (!rows.some((r) => r.start <= days.at(-1) && r.end >= days[0])) {
    tally.unlisted++;
    continue;
  }
  queuedDays += days.length - best;
  queue.push({ ticker, last: days.at(-1), missing: days.length - best });
}
queue.sort((a, b) => b.last.localeCompare(a.last) || b.missing - a.missing);
fs.writeFileSync(`${DIR}/tiingo-queue.txt`, queue.map((q) => q.ticker).join('\n'));
console.log(
  `members: priced ${tally.priced}; queued for Tiingo ${queue.length}; Tiingo tried without full cover ${tally.tried}; symbol reused by a listed company ${tally.reused}; not listed by Tiingo ${tally.unlisted}`
);
console.log(
  `member-days priced now ${((pricedDays / totalDays) * 100).toFixed(1)}%; the queue could add up to ${((queuedDays / totalDays) * 100).toFixed(1)} points`
);
