import { describe, expect, it } from 'vitest';
import { isSignalApiRequest, isSignalPage } from '@/lib/is-signal-request';

describe('isSignalPage', () => {
  it('treats the screener, holdings pages and ticker details as signal pages', () => {
    expect(isSignalPage('/')).toBe(true);
    expect(isSignalPage('/portfolio')).toBe(true);
    expect(isSignalPage('/watchlist')).toBe(true);
    expect(isSignalPage('/AAPL')).toBe(true);
    expect(isSignalPage('/AAPL/backtest')).toBe(true);
  });

  it('leaves non-signal pages cacheable', () => {
    expect(isSignalPage('/alerts')).toBe(false);
    expect(isSignalPage('/market-screen')).toBe(false);
    expect(isSignalPage('/offline')).toBe(false);
    expect(isSignalPage('/serwist/sw.js')).toBe(false);
  });
});

describe('isSignalApiRequest', () => {
  it('matches screener, portfolio and watchlist reads only', () => {
    const at = (path: string) => new URL(path, 'http://localhost:5100');
    expect(isSignalApiRequest(at('/api/screener?tickers=AAPL'))).toBe(true);
    expect(isSignalApiRequest(at('/api/screener/AAPL/ohlcv?days=180'))).toBe(true);
    expect(isSignalApiRequest(at('/api/portfolio'))).toBe(true);
    expect(isSignalApiRequest(at('/api/watchlist'))).toBe(true);
    expect(isSignalApiRequest(at('/api/market/fx?currency=KRW'))).toBe(false);
    expect(isSignalApiRequest(at('/api/market-screens'))).toBe(false);
  });
});
