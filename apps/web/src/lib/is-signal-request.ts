/** Routes whose pages never carry engine decisions and may be served from cache. */
const NON_SIGNAL_SEGMENTS = new Set(['alerts', 'market-screen', 'offline', 'serwist', '_next']);

/**
 * Pages that render BUY/SELL/HOLD decisions: the screener, portfolio,
 * watchlist and every ticker detail. These must come from the network so a
 * prior session's signals never appear as current.
 */
export function isSignalPage(pathname: string): boolean {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return true;
  if (NON_SIGNAL_SEGMENTS.has(segments[0])) return false;
  if (segments[0] === 'portfolio' || segments[0] === 'watchlist') return true;
  return segments.length <= 2; // /TICKER and /TICKER/backtest
}

/** API reads whose payload includes engine decisions or per-user holdings. */
export function isSignalApiRequest(url: URL): boolean {
  return (
    url.pathname.startsWith('/api/screener') ||
    url.pathname.startsWith('/api/portfolio') ||
    url.pathname.startsWith('/api/watchlist')
  );
}
