import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _getCrumb, getCrumbClear } from 'yahoo-finance2/lib/getCrumb';
import { yahooCookieJar } from '@/services/yahoo-finance';
import { getYahooIndustry } from '@/services/yahoo-industry';

vi.mock('yahoo-finance2/lib/getCrumb', () => ({
  _getCrumb: vi.fn(),
  getCrumbClear: vi.fn(),
}));
vi.mock('@/services/yahoo-finance', () => ({
  yahooCookieJar: { getCookieString: vi.fn() },
}));

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(_getCrumb).mockResolvedValue('private-crumb');
  vi.mocked(yahooCookieJar.getCookieString).mockResolvedValue('private-cookie');
  fetchMock.mockImplementation(async () =>
    Response.json({ data: { topCompanies: [{ symbol: 'SLB' }] } })
  );
});

afterEach(() => vi.unstubAllGlobals());

describe('Yahoo industry authentication adapter', () => {
  it('uses the shared SDK cookie jar, bounded signal and explicit US region', async () => {
    await expect(getYahooIndustry('oil-gas-equipment-services')).resolves.toEqual({
      data: { topCompanies: [{ symbol: 'SLB' }] },
    });
    expect(_getCrumb).toHaveBeenCalledWith(
      yahooCookieJar,
      fetchMock,
      { signal: expect.any(AbortSignal) },
      expect.any(Object)
    );
    const [input, init] = fetchMock.mock.calls[0];
    const url = input as URL;
    expect(url.origin).toBe('https://query1.finance.yahoo.com');
    expect(url.pathname).toBe('/v1/finance/industries/oil-gas-equipment-services');
    expect(url.searchParams.get('region')).toBe('US');
    expect(url.searchParams.get('crumb')).toBe('private-crumb');
    expect(init?.headers).toEqual({ cookie: 'private-cookie' });
    expect(init?.signal).toBe(vi.mocked(_getCrumb).mock.calls[0][2].signal);
  });

  it.each(['', '../secret', 'Oil-Gas', 'https://example.com', 'x'.repeat(129)])(
    'rejects invalid industry key %s before authentication',
    async (key) => {
      await expect(getYahooIndustry(key)).rejects.toThrow(TypeError);
      expect(_getCrumb).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it('does not send an unauthenticated industry request', async () => {
    vi.mocked(_getCrumb).mockResolvedValue(null);
    await expect(getYahooIndustry('software-infrastructure')).rejects.toThrow(
      'authentication is unavailable'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('coalesces concurrent authentication without blocking different industry requests', async () => {
    let resolveCrumb: (value: string) => void = () => {};
    vi.mocked(_getCrumb).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCrumb = resolve;
        })
    );
    const first = getYahooIndustry('oil-gas-equipment-services');
    const second = getYahooIndustry('software-infrastructure');
    expect(_getCrumb).toHaveBeenCalledTimes(1);
    resolveCrumb('private-crumb');
    await Promise.all([first, second]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('invalidates expired auth without retries or leaking provider response text', async () => {
    fetchMock.mockResolvedValue(new Response('private-crumb and private-cookie', { status: 401 }));
    await expect(getYahooIndustry('software-infrastructure')).rejects.toThrow(
      'Yahoo Finance industry request failed (401)'
    );
    expect(getCrumbClear).toHaveBeenCalledWith(yahooCookieJar);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry rate-limited requests', async () => {
    fetchMock.mockResolvedValue(new Response('Provider private diagnostics', { status: 429 }));
    await expect(getYahooIndustry('software-infrastructure')).rejects.toThrow(
      'Yahoo Finance industry request failed (429)'
    );
    expect(getCrumbClear).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
