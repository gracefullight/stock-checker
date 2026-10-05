export function formatPaperPercentage(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(2)}%` : '—';
}

export function formatPaperPrice(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 0.000001) {
    return `${value.toExponential(3)} USD`;
  }
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 6,
      }).format(value)
    : '—';
}

export function formatPaperTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return '—';
  return new Date(value)
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, ' UTC');
}

export function formatPaperSession(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : '—';
}
