import { DateTime } from 'luxon';

/**
 * Published NYSE calendar shared by the daily report, alerts, and paper performance.
 * https://www.nyse.com/trade/hours-calendars (2026–2028). Unknown years fail closed:
 * every helper returns null / false outside the verified range instead of guessing.
 */
export const US_MARKET_TIMEZONE = 'America/New_York';
export const SUPPORTED_YEARS = Object.freeze({ from: 2026, to: 2028 });

export const NYSE_HOLIDAYS: ReadonlySet<string> = new Set([
  '2026-01-01',
  '2026-01-19',
  '2026-02-16',
  '2026-04-03',
  '2026-05-25',
  '2026-06-19',
  '2026-07-03',
  '2026-09-07',
  '2026-11-26',
  '2026-12-25',
  '2027-01-01',
  '2027-01-18',
  '2027-02-15',
  '2027-03-26',
  '2027-05-31',
  '2027-06-18',
  '2027-07-05',
  '2027-09-06',
  '2027-11-25',
  '2027-12-24',
  '2028-01-17',
  '2028-02-21',
  '2028-04-14',
  '2028-05-29',
  '2028-06-19',
  '2028-07-04',
  '2028-09-04',
  '2028-11-23',
  '2028-12-25',
]);

export const NYSE_EARLY_CLOSES: ReadonlySet<string> = new Set([
  '2026-11-27',
  '2026-12-24',
  '2027-11-26',
  '2028-07-03',
  '2028-11-24',
]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Parses an ISO date in New York time; invalid or unsupported dates return null. */
export function parseSessionDate(date: string): DateTime | null {
  if (!ISO_DATE.test(date)) return null;
  const parsed = DateTime.fromISO(date, { zone: US_MARKET_TIMEZONE });
  return isSupportedDate(parsed) ? parsed : null;
}

export function isSupportedDate(date: DateTime): boolean {
  return date.isValid && date.year >= SUPPORTED_YEARS.from && date.year <= SUPPORTED_YEARS.to;
}

/** True only for verified regular NYSE sessions (weekday, not a holiday, within range). */
export function isSession(date: DateTime | string): boolean {
  const parsed = typeof date === 'string' ? parseSessionDate(date) : date;
  if (!parsed || !isSupportedDate(parsed)) return false;
  return parsed.weekday <= 5 && !NYSE_HOLIDAYS.has(parsed.toISODate() as string);
}

/** Epoch millis of a New York wall-clock time on the given session date. */
export function sessionTimeAt(date: string, hour: number, minute = 0): number {
  return DateTime.fromISO(date, { zone: US_MARKET_TIMEZONE }).set({ hour, minute }).toMillis();
}

export const sessionOpenAt = (date: string): number => sessionTimeAt(date, 9, 30);

export const sessionCloseAt = (date: string): number =>
  sessionTimeAt(date, NYSE_EARLY_CLOSES.has(date) ? 13 : 16);

/** The next `count` sessions strictly after `date`; null when the window leaves the calendar. */
export function sessionsAfter(date: string, count: number): string[] | null {
  let cursor = parseSessionDate(date);
  if (!cursor) return null;
  const sessions: string[] = [];
  while (sessions.length < count) {
    cursor = cursor.plus({ days: 1 });
    if (!isSupportedDate(cursor)) return null;
    if (isSession(cursor)) sessions.push(cursor.toISODate() as string);
  }
  return sessions;
}

/** The latest session whose close is at or before `now`; null outside the calendar. */
export function latestCompletedSession(now: Date | number = new Date()): string | null {
  const instant = typeof now === 'number' ? now : now.getTime();
  let cursor = DateTime.fromMillis(instant, { zone: US_MARKET_TIMEZONE }).startOf('day');
  if (!isSupportedDate(cursor)) return null;
  for (let step = 0; step < 14; step += 1) {
    const date = cursor.toISODate() as string;
    if (isSession(cursor) && sessionCloseAt(date) <= instant) return date;
    cursor = cursor.minus({ days: 1 });
    if (!isSupportedDate(cursor)) return null;
  }
  return null;
}

/** The first session whose open is after `now`; null outside the calendar. */
export function nextSessionOpen(now: Date | number = new Date()): string | null {
  const instant = typeof now === 'number' ? now : now.getTime();
  let cursor = DateTime.fromMillis(instant, { zone: US_MARKET_TIMEZONE }).startOf('day');
  if (!isSupportedDate(cursor)) return null;
  for (let step = 0; step < 14; step += 1) {
    const date = cursor.toISODate() as string;
    if (isSession(cursor) && sessionOpenAt(date) > instant) return date;
    cursor = cursor.plus({ days: 1 });
    if (!isSupportedDate(cursor)) return null;
  }
  return null;
}
