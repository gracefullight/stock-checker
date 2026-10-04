import { describe, expect, it } from 'vitest';
import { isMarketScreenRequest } from '@/features/market-screen/utils/market-screen-cache';

describe('live market-screen cache boundary', () => {
  it.each([
    'http://localhost:5101/api/market-screens?offset=0',
    'http://localhost:5101/api/market-screens/job?kind=matches',
    'https://stock.example/api/market-screens/job/resume',
  ])('excludes status and control requests from cached market data: %s', (url) => {
    expect(isMarketScreenRequest(new URL(url))).toBe(true);
  });

  it.each([
    'http://localhost:5101/api/screener?tickers=AA',
    'http://localhost:5101/api/market-screens-other',
    'http://localhost:5100/market-screen',
  ])('preserves the existing cache policy for other paths: %s', (url) => {
    expect(isMarketScreenRequest(new URL(url))).toBe(false);
  });
});
