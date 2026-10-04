/** Separate job reads and controls from the PWA's last-known market-data cache. */
export function isMarketScreenRequest(url: URL): boolean {
  return url.pathname === '/api/market-screens' || url.pathname.startsWith('/api/market-screens/');
}
