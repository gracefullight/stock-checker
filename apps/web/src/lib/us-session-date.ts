const NEW_YORK_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Calendar date in America/New_York for an ISO timestamp. The Sydney 09:00
 * daily report runs the evening before in New York, so this is the completed
 * US session the job describes.
 */
export function usSessionDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return NEW_YORK_DATE.format(new Date(ms));
}
