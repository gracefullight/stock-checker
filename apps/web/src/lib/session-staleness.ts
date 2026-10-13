/** Calendar days a completed session may trail today before the row is flagged. */
export const MAX_SESSION_AGE_DAYS = 5;

export type SessionStaleReason = 'behind-latest' | 'too-old' | null;

export interface SessionStaleness {
  stale: boolean;
  /** Calendar days between the session and today; null when the date is unusable. */
  ageDays: number | null;
  reason: SessionStaleReason;
  /** Korean one-liner for a badge or tooltip; empty when fresh. */
  message: string;
}

function utcDay(value: string | Date): number | null {
  const ms =
    typeof value === 'string'
      ? Date.parse(`${value.slice(0, 10)}T00:00:00Z`)
      : Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
  return Number.isFinite(ms) ? Math.floor(ms / 86_400_000) : null;
}

/**
 * Flag a per-row session date that is older than the newest session in the
 * same table or older than the allowed calendar age (long weekends included).
 */
export function sessionStaleness(
  sessionDate: string | null | undefined,
  options: { today?: Date; latest?: string | null; maxCalendarDays?: number } = {}
): SessionStaleness {
  if (!sessionDate) {
    return { stale: true, ageDays: null, reason: 'too-old', message: '세션 날짜 없음' };
  }
  const day = utcDay(sessionDate);
  const todayDay = utcDay(options.today ?? new Date());
  if (day === null || todayDay === null) {
    return { stale: true, ageDays: null, reason: 'too-old', message: '세션 날짜를 읽을 수 없음' };
  }
  const ageDays = todayDay - day;
  const latestDay = options.latest ? utcDay(options.latest) : null;
  if (latestDay !== null && day < latestDay) {
    return {
      stale: true,
      ageDays,
      reason: 'behind-latest',
      message: `다른 종목보다 오래된 세션 (${sessionDate})`,
    };
  }
  if (ageDays > (options.maxCalendarDays ?? MAX_SESSION_AGE_DAYS)) {
    return {
      stale: true,
      ageDays,
      reason: 'too-old',
      message: `${ageDays}일 전 세션 (${sessionDate}) · 캐시 또는 데이터 지연 가능`,
    };
  }
  return { stale: false, ageDays, reason: null, message: '' };
}

/** Newest YYYY-MM-DD among rows, or null when none parse. */
export function latestSessionDate(dates: Array<string | null | undefined>): string | null {
  let latest: string | null = null;
  for (const date of dates) {
    if (!date || utcDay(date) === null) continue;
    if (latest === null || date.slice(0, 10) > latest) latest = date.slice(0, 10);
  }
  return latest;
}
