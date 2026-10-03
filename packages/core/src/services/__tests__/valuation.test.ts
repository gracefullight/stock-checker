import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { getValuation as GetValuation } from '@/services/valuation';

const { quoteSummaryMock, industryMock } = vi.hoisted(() => ({
  quoteSummaryMock: vi.fn(),
  industryMock: vi.fn(),
}));

vi.mock('@/services/yahoo-finance', () => ({
  default: { quoteSummary: quoteSummaryMock },
}));
vi.mock('@/services/yahoo-industry', () => ({ getYahooIndustry: industryMock }));

const NOW = new Date('2026-10-03T12:00:00.000Z');
const INDUSTRY = 'Oil & Gas Equipment & Services';
const INDUSTRY_KEY = 'oil-gas-equipment-services';
const QUOTE_TIME = new Date('2026-10-02T20:00:00.000Z');

function summary(
  pe: unknown = 20,
  psr: unknown = 2,
  overrides: {
    eps?: unknown;
    forwardPE?: unknown;
    industry?: unknown;
    industryKey?: unknown;
    quoteType?: unknown;
    currency?: unknown;
    time?: unknown;
  } = {}
) {
  return {
    summaryDetail: {
      trailingPE: pe,
      forwardPE: overrides.forwardPE ?? 18,
      priceToSalesTrailing12Months: psr,
    },
    defaultKeyStatistics: { trailingEps: overrides.eps ?? 2 },
    summaryProfile: {
      industry: overrides.industry ?? INDUSTRY,
      industryKey: overrides.industryKey ?? INDUSTRY_KEY,
      sector: 'Energy',
    },
    price: {
      quoteType: overrides.quoteType ?? 'EQUITY',
      currency: overrides.currency ?? 'USD',
      regularMarketTime: overrides.time ?? QUOTE_TIME,
    },
  };
}

function industry(symbols: unknown[]) {
  return {
    data: {
      topCompanies: symbols.map((symbol) => ({ symbol })),
      overview: { companiesCount: 45 },
    },
  };
}

describe('getValuation', () => {
  let getValuation: typeof GetValuation;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.resetModules();
    quoteSummaryMock.mockReset();
    industryMock.mockReset();
    ({ getValuation } = await import('@/services/valuation'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns TTM medians resilient to outliers, separate forward PER, and relative premiums', async () => {
    quoteSummaryMock.mockImplementation(async (ticker: string) => {
      const values: Record<string, unknown> = {
        OII: summary(30, 3, { forwardPE: 19 }),
        SLB: summary(10, 1),
        HAL: summary(20, 2),
        BKR: summary(40, 4),
        NOV: summary(1_000, 1_000),
      };
      return values[ticker];
    });
    industryMock.mockResolvedValue(industry(['OII', 'SLB', 'HAL', 'BKR', 'NOV']));

    const result = await getValuation(' oii ');

    expect(result.ticker).toBe('OII');
    expect(result.retrievedAt).toBe(NOW.toISOString());
    expect(result.company).toMatchObject({
      trailingPE: 30,
      forwardPE: 19,
      psr: 3,
      industry: INDUSTRY,
      industryKey: INDUSTRY_KEY,
      sector: 'Energy',
      currency: 'USD',
      priceAsOf: QUOTE_TIME.toISOString(),
      sourceUrl: 'https://finance.yahoo.com/quote/OII/key-statistics/',
      peReason: null,
      psrReason: null,
    });
    expect(result.industryComparison).toMatchObject({
      status: 'available',
      medianPE: 30,
      medianPSR: 3,
      peSamples: 4,
      psrSamples: 4,
      coverage: {
        candidateCount: 4,
        requestedCount: 4,
        matchingIndustryCount: 4,
        failedRequests: 0,
        providerCompanyCount: 45,
        minimumSamples: 3,
        peerLimit: 12,
      },
    });
    expect(result.relative).toEqual({ pePremiumPct: 0, psrPremiumPct: 0 });
    expect(result.industryComparison.universe).toContain('not the whole industry');
    expect(result.industryComparison.method).toContain('Unweighted median');
    expect(result.warnings.some((warning) => warning.includes('financial period-end'))).toBe(true);
    for (const call of quoteSummaryMock.mock.calls) {
      expect(call[2].fetchOptions.signal).toBeInstanceOf(AbortSignal);
      expect(call[1].modules).toContain('defaultKeyStatistics');
    }
  });

  it('uses independent sample thresholds when loss-making peers still have valid PSR', async () => {
    quoteSummaryMock.mockImplementation(async (ticker: string) => {
      const values: Record<string, unknown> = {
        OII: summary(25, 4),
        SLB: summary(10, 1),
        HAL: summary(-20, 2, { eps: -2 }),
        BKR: summary(50, 3, { eps: 0 }),
        NOV: summary(20, 4),
      };
      return values[ticker];
    });
    industryMock.mockResolvedValue(industry(['SLB', 'HAL', 'BKR', 'NOV']));

    const result = await getValuation('OII');

    expect(result.industryComparison).toMatchObject({
      status: 'partial',
      medianPE: null,
      medianPSR: 2.5,
      peSamples: 2,
      psrSamples: 4,
    });
    expect(
      result.industryComparison.peers.find((peer) => peer.ticker === 'BKR')?.trailingPE
    ).toBeNull();
    expect(result.relative.pePremiumPct).toBeNull();
    expect(result.relative.psrPremiumPct).toBeCloseTo(60);
    expect(result.industryComparison.reason).toContain('trailing PER has 2, PSR has 4');
  });

  it('rejects the subject, duplicate symbols, invalid tickers, other industries, and non-equities', async () => {
    quoteSummaryMock.mockImplementation(async (ticker: string) => {
      if (ticker === 'MSFT') return summary(10, 1, { industryKey: 'software-infrastructure' });
      if (ticker === 'XLE') return summary(10, 1, { quoteType: 'ETF' });
      if (ticker === 'MYSTERY') return { ...summary(), price: {} };
      return summary();
    });
    industryMock.mockResolvedValue(
      industry([
        'OII',
        'oii',
        'SLB',
        ' slb ',
        'HAL',
        'BKR',
        'MSFT',
        'XLE',
        'MYSTERY',
        '../bad',
        null,
      ])
    );

    const result = await getValuation('OII');

    expect(result.industryComparison.peers.map((peer) => peer.ticker)).toEqual([
      'SLB',
      'HAL',
      'BKR',
    ]);
    expect(result.industryComparison.coverage).toMatchObject({
      candidateCount: 6,
      requestedCount: 6,
      matchingIndustryCount: 3,
      excludedIndustryCount: 1,
      excludedNonEquityCount: 2,
    });
    expect(quoteSummaryMock.mock.calls.filter((call) => call[0] === 'SLB')).toHaveLength(1);
    expect(quoteSummaryMock.mock.calls.filter((call) => call[0] === 'OII')).toHaveLength(1);
  });

  it('never uses negative, zero, nonfinite, missing, string, or forward-only metrics', async () => {
    quoteSummaryMock.mockImplementation(async (ticker: string) => {
      const values: Record<string, unknown> = {
        OII: summary(30, 3),
        SLB: summary(undefined, 0),
        HAL: summary(Number.POSITIVE_INFINITY, '2'),
        BKR: summary('30', undefined),
        NOV: summary(-5, -1),
      };
      // Explicit deletion is needed because the fixture parameters have defaults.
      if (ticker === 'SLB')
        return { ...summary(), summaryDetail: { forwardPE: 15, priceToSalesTrailing12Months: 0 } };
      if (ticker === 'BKR')
        return { ...summary(), summaryDetail: { trailingPE: '30', forwardPE: 12 } };
      return values[ticker];
    });
    industryMock.mockResolvedValue(industry(['SLB', 'HAL', 'BKR', 'NOV']));

    const result = await getValuation('OII');

    expect(result.industryComparison).toMatchObject({
      status: 'unavailable',
      medianPE: null,
      medianPSR: null,
      peSamples: 0,
      psrSamples: 0,
    });
    expect(result.relative).toEqual({ pePremiumPct: null, psrPremiumPct: null });
  });

  it.each([-2, 0])(
    'marks company PER unavailable for EPS %s even when the provider PER is positive',
    async (eps) => {
      quoteSummaryMock.mockResolvedValue(summary(50, 2, { eps }));
      industryMock.mockResolvedValue(industry([]));

      const result = await getValuation('OII');

      expect(result.company.trailingPE).toBeNull();
      expect(result.company.forwardPE).toBe(18);
      expect(result.company.psr).toBe(2);
      expect(result.company.peReason).toContain('nonpositive trailing earnings');
    }
  );

  it('accepts Yahoo raw wrappers and preserves actual quote time independently of retrieval time', async () => {
    quoteSummaryMock.mockResolvedValue(
      summary(
        { raw: 20 },
        { raw: 2 },
        {
          eps: { raw: 1 },
          forwardPE: { raw: 17 },
          time: { raw: QUOTE_TIME.getTime() / 1_000 },
        }
      )
    );
    industryMock.mockResolvedValue(industry(['SLB', 'HAL', 'BKR']));

    const result = await getValuation('OII');

    expect(result.company).toMatchObject({
      trailingPE: 20,
      forwardPE: 17,
      psr: 2,
      priceAsOf: QUOTE_TIME.toISOString(),
    });
    expect(result.retrievedAt).toBe(NOW.toISOString());
    expect(result.company.priceAsOf).not.toBe(result.retrievedAt);
    expect(result.industryComparison.medianPE).toBe(20);
  });

  it('preserves company metrics when the industry provider fails without exposing the exception', async () => {
    quoteSummaryMock.mockResolvedValue(summary(20, 2));
    industryMock.mockRejectedValue(new Error('https://example.com/?apikey=private-key'));

    const result = await getValuation('OII');

    expect(result.company.trailingPE).toBe(20);
    expect(result.company.psr).toBe(2);
    expect(result.industryComparison.status).toBe('unavailable');
    expect(result.industryComparison.reason).toBe('Yahoo Finance industry-company request failed.');
    expect(JSON.stringify(result)).not.toContain('private-key');
    expect(quoteSummaryMock).toHaveBeenCalledTimes(1);
  });

  it('retains successful peer observations after partial request failures', async () => {
    quoteSummaryMock.mockImplementation(async (ticker: string) => {
      if (ticker === 'BAD') throw new Error('rate limited');
      return summary(20, 2);
    });
    industryMock.mockResolvedValue(industry(['SLB', 'HAL', 'BKR', 'BAD']));

    const result = await getValuation('OII');

    expect(result.industryComparison).toMatchObject({
      status: 'available',
      medianPE: 20,
      medianPSR: 2,
      peSamples: 3,
      psrSamples: 3,
      coverage: { failedRequests: 1 },
    });
    expect(result.warnings).toContain('1 peer valuation requests failed.');
  });

  it('does not expose stock multiples or request industry peers for a non-equity subject', async () => {
    quoteSummaryMock.mockResolvedValue(summary(20, 2, { quoteType: 'ETF' }));

    const result = await getValuation('XLE');

    expect(result.company).toMatchObject({ trailingPE: null, forwardPE: null, psr: null });
    expect(result.industryComparison.status).toBe('unavailable');
    expect(result.industryComparison.reason).toContain('equity instrument');
    expect(industryMock).not.toHaveBeenCalled();
  });

  it('returns unavailable industry comparisons when no valid industry is supplied', async () => {
    quoteSummaryMock.mockResolvedValue({ ...summary(), summaryProfile: { sector: 'Energy' } });

    const result = await getValuation('OII');

    expect(result.company.trailingPE).toBe(20);
    expect(result.company.industry).toBeNull();
    expect(result.industryComparison.reason).toContain('valid company industry');
    expect(industryMock).not.toHaveBeenCalled();
  });

  it.each(['../secrets', 'http://example.com', 'oil gas', 'OIL-GAS', 'a'.repeat(129)])(
    'does not call the industry provider with an invalid industry key %s',
    async (key) => {
      quoteSummaryMock.mockResolvedValue(summary(20, 2, { industryKey: key }));

      const result = await getValuation('OII');

      expect(result.company.industryKey).toBeNull();
      expect(industryMock).not.toHaveBeenCalled();
    }
  );

  it('preserves an empty provider list as unavailable rather than a zero valuation', async () => {
    quoteSummaryMock.mockResolvedValue(summary());
    industryMock.mockResolvedValue(industry([]));

    const result = await getValuation('OII');

    expect(result.industryComparison).toMatchObject({
      status: 'unavailable',
      peSamples: 0,
      psrSamples: 0,
      medianPE: null,
      medianPSR: null,
    });
  });

  it('returns nullable company metrics after company-provider failure', async () => {
    quoteSummaryMock.mockRejectedValue(new Error('private provider payload'));

    const result = await getValuation('OII');

    expect(result.company).toMatchObject({
      trailingPE: null,
      forwardPE: null,
      psr: null,
      priceAsOf: null,
      peReason: 'Yahoo Finance company-valuation request failed.',
    });
    expect(industryMock).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('private provider payload');
  });

  it('bounds peers to 12, simultaneous peer requests to 3, and reuses a coalesced 15-minute cache', async () => {
    let running = 0;
    let peak = 0;
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    quoteSummaryMock.mockImplementation(async (ticker: string) => {
      if (ticker === 'OII') return summary();
      running++;
      peak = Math.max(peak, running);
      await blocked;
      running--;
      return summary();
    });
    industryMock.mockResolvedValue(industry(Array.from({ length: 20 }, (_, index) => `P${index}`)));

    const first = getValuation('OII');
    const second = getValuation('oii');
    for (let step = 0; step < 10; step++) await Promise.resolve();
    expect(peak).toBe(3);
    release?.();
    const [one, two] = await Promise.all([first, second]);

    expect(one.industryComparison.coverage).toMatchObject({
      candidateCount: 20,
      requestedCount: 12,
      matchingIndustryCount: 12,
    });
    expect(quoteSummaryMock).toHaveBeenCalledTimes(13);
    expect(industryMock).toHaveBeenCalledTimes(1);
    expect(peak).toBe(3);
    expect(one).toEqual(two);
    one.company.trailingPE = 1;
    expect(two.company.trailingPE).toBe(20);
    expect((await getValuation('OII')).company.trailingPE).toBe(20);
    vi.setSystemTime(new Date(NOW.getTime() + 15 * 60 * 1_000 + 1));
    await getValuation('OII');
    expect(industryMock).toHaveBeenCalledTimes(2);
    expect(quoteSummaryMock).toHaveBeenCalledTimes(26);
  });

  it('shares the three-request limit across different simultaneous ticker reports', async () => {
    let running = 0;
    let peak = 0;
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    quoteSummaryMock.mockImplementation(async (ticker: string) => {
      if (ticker === 'OII' || ticker === 'NOV') return summary();
      running++;
      peak = Math.max(peak, running);
      await blocked;
      running--;
      return summary();
    });
    industryMock.mockResolvedValue(industry(['SLB', 'HAL', 'BKR', 'OIS']));

    const first = getValuation('OII');
    const second = getValuation('NOV');
    for (let step = 0; step < 20; step++) await Promise.resolve();
    expect(peak).toBe(3);
    release?.();
    const reports = await Promise.all([first, second]);

    expect(peak).toBe(3);
    expect(reports.every((report) => report.industryComparison.peSamples === 4)).toBe(true);
    expect(quoteSummaryMock).toHaveBeenCalledTimes(10);
  });

  it('bounds pending ticker requests rather than growing the cache and request queue without limit', async () => {
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    quoteSummaryMock.mockImplementation(async () => {
      await blocked;
      return summary();
    });
    industryMock.mockResolvedValue(industry([]));

    const requests = Array.from({ length: 32 }, (_, index) => getValuation(`P${index}`));
    await expect(getValuation('OVERFLOW')).rejects.toThrow('Valuation request capacity exceeded');
    expect(quoteSummaryMock).toHaveBeenCalledTimes(3);
    release?.();
    await Promise.all(requests);

    expect(quoteSummaryMock).toHaveBeenCalledTimes(32);
    await getValuation('OVERFLOW');
    expect(quoteSummaryMock).toHaveBeenCalledTimes(33);
  });

  it.each(['', '../OII', 'OII?token=x', 'A'.repeat(33)])(
    'rejects invalid ticker %s before provider calls',
    async (ticker) => {
      await expect(getValuation(ticker)).rejects.toThrow('Invalid ticker');
      expect(quoteSummaryMock).not.toHaveBeenCalled();
      expect(industryMock).not.toHaveBeenCalled();
    }
  );
});
