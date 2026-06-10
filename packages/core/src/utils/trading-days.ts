/**
 * Count trading days (weekdays) from `from` (exclusive) to `target` (inclusive).
 * Returns a negative count when `target` is in the past.
 *
 * Limitation: US market holidays are not excluded — counts may be off by one
 * during holiday weeks, which is acceptable for proximity warnings.
 */
export function tradingDaysUntil(target: Date, from: Date = new Date()): number {
  const toUtcMidnight = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const start = toUtcMidnight(from);
  const end = toUtcMidnight(target);
  if (start === end) return 0;

  const dayMs = 86_400_000;
  const sign = end > start ? 1 : -1;
  let count = 0;
  for (let t = start + sign * dayMs; ; t += sign * dayMs) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) count += sign;
    if (t === end) break;
  }
  return count;
}
