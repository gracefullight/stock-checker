import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAnalystTargets } from '@/services/analyst-targets';

const { quoteSummaryMock } = vi.hoisted(() => ({ quoteSummaryMock: vi.fn() }));

vi.mock('@/services/yahoo-finance', () => ({
  default: { quoteSummary: quoteSummaryMock },
}));

const NOW = new Date('2026-10-03T12:00:00.000Z');
const CONSENSUS = {
  financialData: {
    currentPrice: 100,
    targetMeanPrice: 125,
    targetMedianPrice: 120,
    targetLowPrice: 90,
    targetHighPrice: 150,
    numberOfAnalystOpinions: 25,
  },
  price: { currency: 'USD' },
};

function yahooHistory(history: unknown[]) {
  quoteSummaryMock.mockResolvedValueOnce(CONSENSUS);
  quoteSummaryMock.mockResolvedValueOnce({ upgradeDowngradeHistory: { history } });
}

function update(overrides: Record<string, unknown> = {}) {
  return {
    epochGradeDate: new Date('2026-09-25T12:00:00.000Z'),
    firm: 'Research Firm',
    currentPriceTarget: 130,
    priorPriceTarget: 120,
    toGrade: 'Buy',
    priceTargetAction: 'Raises',
    ...overrides,
  };
}

function fmpUpdate(overrides: Record<string, unknown> = {}) {
  return {
    symbol: 'AAPL',
    publishedDate: '2026-09-30T10:30:00.000Z',
    analystCompany: 'Independent Research',
    analystName: 'Analyst A',
    priceTarget: 140,
    priorPriceTarget: 135,
    priceWhenPosted: 105,
    newsURL: 'https://news.example.com/target-update',
    ...overrides,
  };
}

describe('getAnalystTargets', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    quoteSummaryMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('FMP_API_KEY', '');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('keeps consensus when the independent history request fails', async () => {
    quoteSummaryMock.mockResolvedValueOnce(CONSENSUS);
    quoteSummaryMock.mockRejectedValueOnce(new Error('history unavailable'));

    const result = await getAnalystTargets(' aapl ');

    expect(result.ticker).toBe('AAPL');
    expect(result.consensus).toMatchObject({
      source: 'Yahoo Finance',
      currency: 'USD',
      mean: 125,
      median: 120,
      low: 90,
      high: 150,
      analystCount: 25,
      meanUpsidePercent: 25,
      retrievedAt: NOW.toISOString(),
      publishedAt: null,
      horizon: null,
    });
    expect(result.recent.status).toBe('unavailable');
    expect(result.warnings).toContain('Yahoo Finance analyst-history request failed.');
    expect(fetchMock).not.toHaveBeenCalled();
    for (const call of quoteSummaryMock.mock.calls) {
      expect(call[2].fetchOptions.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('accepts the same maximum symbol length as the MCP report', async () => {
    quoteSummaryMock.mockResolvedValue({});

    const result = await getAnalystTargets('A'.repeat(32));

    expect(result.ticker).toHaveLength(32);
    expect(quoteSummaryMock).toHaveBeenCalledTimes(2);
  });

  it('returns only actual valid dated Yahoo targets, newest first, without consulting FMP', async () => {
    vi.stubEnv('FMP_API_KEY', 'configured-key');
    const older = update({
      epochGradeDate: new Date('2026-08-01T12:00:00Z'),
      currentPriceTarget: 115,
    });
    const latest = update();
    yahooHistory([
      older,
      update({ currentPriceTarget: 0 }),
      update({ currentPriceTarget: Number.POSITIVE_INFINITY }),
      update({ currentPriceTarget: '130' }),
      update({ epochGradeDate: new Date('invalid') }),
      update({ epochGradeDate: new Date('2026-10-04T00:00:00Z') }),
      update({ firm: ' ' }),
      update({ epochGradeDate: new Date('2026-06-01T12:00:00Z') }),
      latest,
      latest,
      { firm: 'Rating Only', toGrade: 'Buy', epochGradeDate: NOW },
    ]);

    const result = await getAnalystTargets('AAPL');

    expect(result.recent).toMatchObject({
      status: 'available',
      source: 'Yahoo Finance',
      count30Days: 1,
      windowDays: 90,
      limit: null,
    });
    expect(result.recent.updates.map((row) => row.targetPrice)).toEqual([130, 115]);
    expect(result.recent.updates[0]).toMatchObject({
      targetPrice: 130,
      priorTargetPrice: 120,
      publishedAt: '2026-09-25T12:00:00.000Z',
      action: 'Raises',
      rating: 'Buy',
      horizon: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts Yahoo raw number wrappers and epoch seconds', async () => {
    yahooHistory([
      update({
        epochGradeDate: { raw: Date.parse('2026-09-20T10:00:00Z') / 1_000 },
        currentPriceTarget: { raw: 145 },
        priorPriceTarget: -1,
      }),
    ]);

    const result = await getAnalystTargets('AAPL');

    expect(result.recent.updates[0]).toMatchObject({
      publishedAt: '2026-09-20T10:00:00.000Z',
      targetPrice: 145,
      priorTargetPrice: null,
    });
  });

  it('distinguishes an available source with no recent targets from unavailable data', async () => {
    yahooHistory([update({ epochGradeDate: new Date('2026-03-01T12:00:00Z') })]);

    const result = await getAnalystTargets('AAPL');

    expect(result.recent.status).toBe('available');
    expect(result.recent.updates).toEqual([]);
    expect(result.recent.count30Days).toBe(0);
  });

  it('uses optional FMP when Yahoo provides ratings without numeric targets', async () => {
    vi.stubEnv('FMP_API_KEY', 'test-api-key');
    yahooHistory([{ firm: 'Rating Only', toGrade: 'Buy', epochGradeDate: NOW }]);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          fmpUpdate(),
          fmpUpdate({
            publishedDate: '2026-08-14T11:00:00+02:00',
            priceTarget: 125,
          }),
        ])
      )
    );

    const result = await getAnalystTargets('AAPL');

    expect(result.consensus?.mean).toBe(125);
    expect(result.recent).toMatchObject({
      status: 'available',
      source: 'Financial Modeling Prep',
      count30Days: 1,
      limit: 20,
    });
    expect(result.recent.updates[0]).toMatchObject({
      sourceUrl: 'https://news.example.com/target-update',
      targetPrice: 140,
      priorTargetPrice: 135,
      priceWhenPosted: 105,
      analystName: 'Analyst A',
    });
    expect(result.recent.updates[1].publishedAt).toBe('2026-08-14T09:00:00.000Z');
    const [requestUrl, options] = fetchMock.mock.calls[0];
    const url = new URL(String(requestUrl));
    expect(url.origin + url.pathname).toBe(
      'https://financialmodelingprep.com/stable/price-target-news'
    );
    expect(url.searchParams.get('symbol')).toBe('AAPL');
    expect(url.searchParams.get('limit')).toBe('20');
    expect(url.searchParams.get('page')).toBe('0');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed, undated, impossible, future, and other-symbol FMP records', async () => {
    vi.stubEnv('FMP_API_KEY', 'test-api-key');
    yahooHistory([]);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          fmpUpdate({ priceTarget: 0 }),
          fmpUpdate({ priceTarget: '150' }),
          fmpUpdate({ publishedDate: '2026-02-30T10:30:00Z' }),
          fmpUpdate({ publishedDate: '2026-09-30 10:30:00' }),
          fmpUpdate({ publishedDate: '2026-10-04T10:30:00Z' }),
          fmpUpdate({ symbol: 'MSFT' }),
          fmpUpdate({ analystCompany: '' }),
          fmpUpdate({ newsURL: 'javascript:alert(1)', priceTarget: 155 }),
        ])
      )
    );

    const result = await getAnalystTargets('AAPL');

    expect(result.recent.updates).toHaveLength(1);
    expect(result.recent.updates[0].targetPrice).toBe(155);
    expect(result.recent.updates[0].sourceUrl).toBeNull();
  });

  it('limits optional FMP records to one bounded request', async () => {
    vi.stubEnv('FMP_API_KEY', 'test-api-key');
    yahooHistory([]);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify(Array.from({ length: 30 }, (_, i) => fmpUpdate({ priceTarget: 150 + i })))
      )
    );

    const result = await getAnalystTargets('AAPL');

    expect(result.recent.updates).toHaveLength(20);
    expect(result.recent.limit).toBe(20);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps dated targets if the consensus provider fails', async () => {
    quoteSummaryMock.mockRejectedValueOnce(new Error('consensus unavailable'));
    quoteSummaryMock.mockResolvedValueOnce({ upgradeDowngradeHistory: { history: [update()] } });

    const result = await getAnalystTargets('AAPL');

    expect(result.consensus).toBeNull();
    expect(result.recent.updates).toHaveLength(1);
    expect(result.warnings).toContain('Yahoo Finance consensus request failed.');
  });

  it('reports absence honestly without requiring a new API key', async () => {
    yahooHistory([]);

    const result = await getAnalystTargets('AAPL');

    expect(result.recent.status).toBe('unavailable');
    expect(result.recent.reason).toContain('FMP_API_KEY is not configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not leak the API key or a secret URL when optional FMP fails', async () => {
    vi.stubEnv('FMP_API_KEY', 'secret-key-value');
    yahooHistory([]);
    fetchMock.mockRejectedValueOnce(
      new Error('failed https://example.com?apikey=secret-key-value')
    );

    const result = await getAnalystTargets('AAPL');

    expect(result.consensus?.mean).toBe(125);
    expect(result.recent.status).toBe('unavailable');
    expect(JSON.stringify(result)).not.toContain('secret-key-value');
    expect(JSON.stringify(result)).not.toContain('example.com');
  });

  it.each([new Response('provider error', { status: 403 }), new Response('{}')])(
    'handles an unavailable or malformed optional FMP response',
    async (response) => {
      vi.stubEnv('FMP_API_KEY', 'test-api-key');
      yahooHistory([]);
      fetchMock.mockResolvedValueOnce(response);

      const result = await getAnalystTargets('AAPL');

      expect(result.recent.status).toBe('unavailable');
      expect(result.consensus?.mean).toBe(125);
    }
  );

  it('reports an empty successful FMP response separately from a provider failure', async () => {
    vi.stubEnv('FMP_API_KEY', 'test-api-key');
    yahooHistory([]);
    fetchMock.mockResolvedValueOnce(new Response('[]'));

    const result = await getAnalystTargets('AAPL');

    expect(result.recent.status).toBe('available');
    expect(result.recent.updates).toEqual([]);
  });

  it('reports unavailable when FMP returns no valid dated records', async () => {
    vi.stubEnv('FMP_API_KEY', 'test-api-key');
    yahooHistory([]);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([fmpUpdate({ priceTarget: -1 })])));

    const result = await getAnalystTargets('AAPL');

    expect(result.recent.status).toBe('unavailable');
    expect(result.recent.reason).toContain('valid dated targets');
  });

  it('rejects invalid consensus fields and inconsistent price ranges', async () => {
    quoteSummaryMock.mockResolvedValueOnce({
      financialData: {
        currentPrice: 0,
        targetMeanPrice: Number.NaN,
        targetMedianPrice: 120,
        targetLowPrice: 150,
        targetHighPrice: 90,
        numberOfAnalystOpinions: 2.5,
      },
      price: { regularMarketPrice: 100, currency: 'USD' },
    });
    quoteSummaryMock.mockResolvedValueOnce({});

    const result = await getAnalystTargets('AAPL');

    expect(result.consensus).toMatchObject({
      currentPrice: 100,
      mean: null,
      median: 120,
      low: null,
      high: null,
      analystCount: null,
      meanUpsidePercent: null,
    });
  });

  it('leaves consensus unavailable when all target fields are absent or invalid', async () => {
    quoteSummaryMock.mockResolvedValueOnce({
      financialData: { currentPrice: 100, targetMeanPrice: -1 },
    });
    quoteSummaryMock.mockResolvedValueOnce({});

    const result = await getAnalystTargets('AAPL');

    expect(result.consensus).toBeNull();
  });

  it.each(['', '../../secrets', 'AAPL?apikey=anything', 'AAPL\nMSFT'])(
    'rejects an invalid ticker %j before contacting a provider',
    async (ticker) => {
      await expect(getAnalystTargets(ticker)).rejects.toThrow('Invalid ticker');
      expect(quoteSummaryMock).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );
});
