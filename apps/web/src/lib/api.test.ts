import { afterEach, describe, expect, it, vi } from 'vitest';

// vi.mock is hoisted above the module body, so the mock state it references must
// be created with vi.hoisted (a plain `const` would be in the temporal dead zone).
const { requestMock, holder } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  holder: { err: undefined as ((e: unknown) => unknown) | undefined },
}));

vi.mock('axios', () => ({
  default: {
    create: () => ({
      request: requestMock,
      interceptors: {
        response: {
          use: (_ok: unknown, err: (e: unknown) => unknown) => {
            holder.err = err;
          },
        },
      },
    }),
  },
}));

import {
  addToPortfolio,
  getFearGreed,
  getOHLCV,
  getPortfolio,
  getScreener,
  getScreenerResponse,
  getTickerDetail,
  parseMarketScreenJobId,
  removeFromPortfolio,
} from '@/lib/api';

afterEach(() => {
  requestMock.mockReset();
});

describe('api fetcher', () => {
  it('getScreener returns the results array and joins tickers', async () => {
    requestMock.mockResolvedValue({ data: { results: [{ ticker: 'AAPL' }] } });
    await expect(getScreener(['AAPL', 'TSLA'])).resolves.toEqual([{ ticker: 'AAPL' }]);
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/api/screener?tickers=AAPL%2CTSLA' })
    );
  });

  it('getTickerDetail encodes the ticker and passes include', async () => {
    requestMock.mockResolvedValue({ data: { ticker: 'A/B' } });
    await getTickerDetail('A/B', ['fundamentals']);
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/api/screener/A%2FB?include=fundamentals' })
    );
  });

  it('getPortfolio extracts .assets from the response envelope', async () => {
    requestMock.mockResolvedValue({ data: { assets: ['AAPL'], createdAt: 'x' } });
    await expect(getPortfolio()).resolves.toEqual(['AAPL']);
    expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({ url: '/api/portfolio' }));
  });

  it('addToPortfolio POSTs an encoded ticker', async () => {
    requestMock.mockResolvedValue({ data: undefined });
    await addToPortfolio('A/B');
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/api/portfolio/A%2FB', method: 'POST' })
    );
  });

  it('removeFromPortfolio DELETEs an encoded ticker', async () => {
    requestMock.mockResolvedValue({ data: undefined });
    await removeFromPortfolio('A/B');
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/api/portfolio/A%2FB', method: 'DELETE' })
    );
  });

  it('getOHLCV passes days and encodes the ticker', async () => {
    requestMock.mockResolvedValue({ data: [] });
    await getOHLCV('AAPL', 90);
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/api/screener/AAPL/ohlcv?days=90' })
    );
  });

  it('getFearGreed hits the market endpoint', async () => {
    requestMock.mockResolvedValue({ data: { value: 10 } });
    await getFearGreed();
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/api/market/fear-greed' })
    );
  });

  it('normalizes HTTP errors via the response interceptor', () => {
    expect(holder.err).toBeDefined();
    expect(() => holder.err?.({ response: { status: 404, statusText: 'Not Found' } })).toThrow(
      'API error 404: Not Found'
    );
  });

  it("surfaces the server's actionable error text instead of the bare status", () => {
    expect(() =>
      holder.err?.({
        response: {
          status: 404,
          statusText: 'Not Found',
          data: { error: 'No data found for ticker: ZZZZ' },
        },
      })
    ).toThrow('API error 404: No data found for ticker: ZZZZ');
  });

  it('normalizes network errors and adds a reachability hint', () => {
    expect(() => holder.err?.({ message: 'Network Error', code: 'ERR_NETWORK' })).toThrow(
      'API error: Network Error'
    );
    expect(() => holder.err?.({ message: 'Network Error', code: 'ERR_NETWORK' })).toThrow(
      /mise run dev:api/
    );
    expect(() => holder.err?.({ message: 'Request aborted' })).not.toThrow(/mise run dev:api/);
  });

  it('getScreenerResponse keeps the unavailable list and generation time when present', async () => {
    requestMock.mockResolvedValue({
      data: {
        results: [{ ticker: 'AAPL' }],
        unavailable: [{ ticker: 'ZZZZ', reason: 'history-unavailable' }, { bad: true }],
        generatedAt: '2026-10-14T00:00:00.000Z',
      },
    });
    await expect(getScreenerResponse(['AAPL', 'ZZZZ'])).resolves.toEqual({
      results: [{ ticker: 'AAPL' }],
      unavailable: [{ ticker: 'ZZZZ', reason: 'history-unavailable' }],
      generatedAt: '2026-10-14T00:00:00.000Z',
    });
  });

  it('parses market-screen deep-link ids defensively', () => {
    expect(parseMarketScreenJobId('11111111-1111-4111-8111-111111111111')).toBe(
      '11111111-1111-4111-8111-111111111111'
    );
    expect(parseMarketScreenJobId(['22222222-2222-4222-8222-222222222222'])).toBe(
      '22222222-2222-4222-8222-222222222222'
    );
    expect(parseMarketScreenJobId('not-a-job')).toBeNull();
    expect(parseMarketScreenJobId(undefined)).toBeNull();
  });
});
