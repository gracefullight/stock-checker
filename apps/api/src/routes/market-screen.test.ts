import type {
  MarketScreenJobList,
  MarketScreenJobSnapshot,
  MarketScreenPerformanceSnapshot,
} from '@stock-checker/core/src/reports/market-screen';
import { MarketScreenJobNotFoundError } from '@stock-checker/core/src/reports/market-screen';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type MarketScreenApiService, marketScreenRoutes } from '@/routes/market-screen';

const JOB_ID = 'bd6128e1-d410-4a61-a90e-dfbd6a86167e';

function performanceFixture(): MarketScreenPerformanceSnapshot {
  return {
    jobId: JOB_ID,
    policy: {
      id: 'us-buy-next-open-five-session-v1',
      mode: 'forward-paper',
      timezone: 'America/New_York',
      entry: 'next-session-open',
      exit: 'fifth-session-close',
      horizonSessions: 5,
      costBpsRoundTrip: 10,
      adjustment: 'same-fetched-adjusted-series',
    },
    updatedAt: null,
    summary: {
      totalRecommendations: 1,
      completed: 0,
      wins: 0,
      losses: 0,
      breakeven: 0,
      pending: 1,
      open: 0,
      unavailable: 0,
      ineligible: 0,
      legacyUntracked: 0,
      winRatePct: null,
      averageNetReturnPct: null,
    },
    page: {
      offset: 0,
      limit: 20,
      total: 1,
      hasMore: false,
      items: [
        {
          recommendationId: 'fixture-recommendation',
          ticker: 'AAPL',
          dataAsOf: '2026-10-02',
          recommendedAt: '2026-10-05T13:00:00.000Z',
          status: 'pending',
          reason: 'The next eligible session has not completed.',
          entryDate: null,
          exitDate: null,
          entryPrice: null,
          exitPrice: null,
          grossReturnPct: null,
          netReturnPct: null,
          outcome: null,
          updatedAt: null,
        },
      ],
    },
    refresh: { status: 'idle', selected: 0, processed: 0, reason: null },
  };
}

function fixture(): MarketScreenJobSnapshot {
  return {
    job: {
      schemaVersion: 1,
      id: JOB_ID,
      status: 'partial',
      createdAt: '2026-10-03T12:01:00.000Z',
      updatedAt: '2026-10-03T12:02:00.000Z',
      startedAt: '2026-10-03T12:01:00.000Z',
      finishedAt: '2026-10-03T12:02:00.000Z',
      pauseReason: null,
      universe: {
        source: 'finviz-candidates',
        url: 'https://finviz.com/screener?f=ind_stocksonly,ta_sma50_pb',
        filters: ['ind_stocksonly', 'ta_sma50_pb'],
        sourceTotal: 3963,
        overallTotal: 11702,
        collectedCount: 2,
        inputCount: 2,
        capturedAt: '2026-10-03T12:00:00.000Z',
        pages: 1,
        completeness: 'partial',
      },
      criteria: {
        decision: 'BUY',
        lookbackDays: 730,
        engine: 'Offline final-decision fixture',
        concurrency: 2,
        minIntervalMs: 1000,
      },
      progress: {
        total: 2,
        analyzed: 1,
        unavailable: 1,
        pending: 0,
        inFlight: 0,
        matched: 0,
        excluded: 1,
      },
      warnings: ['Scores are not probabilities of profit.'],
    },
    page: { kind: 'matches', offset: 0, limit: 20, total: 0, hasMore: false, items: [] },
  };
}

function fakeService(value = fixture()) {
  const list: MarketScreenJobList = {
    jobs: [value.job],
    offset: 0,
    limit: 20,
    total: 1,
    hasMore: false,
  };
  return {
    list: vi.fn(async () => list),
    get: vi.fn(async () => value),
    pause: vi.fn(async () => value),
    resume: vi.fn(async () => value),
    getPerformance: vi.fn<MarketScreenApiService['getPerformance']>(async () =>
      performanceFixture()
    ),
    refreshPerformance: vi.fn<MarketScreenApiService['refreshPerformance']>(async () =>
      performanceFixture()
    ),
  } satisfies MarketScreenApiService;
}

describe('marketScreenRoutes', () => {
  let app: FastifyInstance;
  let service: ReturnType<typeof fakeService>;

  beforeEach(async () => {
    vi.stubEnv('CORS_ORIGIN', undefined);
    service = fakeService();
    app = Fastify({ logger: false });
    await app.register(marketScreenRoutes, { prefix: '/api', service });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it('lists saved jobs with bounded defaults without starting a runner', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/market-screens' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(service.list).toHaveBeenCalledWith({ offset: 0, limit: 20 });
    expect(response.json()).toMatchObject({ jobs: [fixture().job], total: 1, hasMore: false });
    expect(service.get).not.toHaveBeenCalled();
    expect(service.pause).not.toHaveBeenCalled();
    expect(service.resume).not.toHaveBeenCalled();
  });

  it('passes integer list pagination beyond the candidate-row bound', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/market-screens?offset=15001&limit=100',
    });
    expect(response.statusCode).toBe(200);
    expect(service.list).toHaveBeenCalledWith({ offset: 15001, limit: 100 });
  });

  it('reads a selected UUID job with matches defaults and preserves partial coverage', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/market-screens/${JOB_ID.toUpperCase()}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(service.get).toHaveBeenCalledWith(JOB_ID, { kind: 'matches', offset: 0, limit: 20 });
    expect(response.json()).toEqual(fixture());
    expect(service.resume).not.toHaveBeenCalled();
  });

  it('passes unavailable result pagination and retains per-ticker errors', async () => {
    const value = fixture();
    value.page = {
      kind: 'unavailable',
      offset: 20,
      limit: 100,
      total: 21,
      hasMore: false,
      items: [{ ticker: 'BAD', reason: 'No usable completed-session analysis.', attempts: 1 }],
    };
    service.get.mockResolvedValue(value);
    const response = await app.inject({
      method: 'GET',
      url: `/api/market-screens/${JOB_ID}?kind=unavailable&offset=20&limit=100`,
    });
    expect(response.statusCode).toBe(200);
    expect(service.get).toHaveBeenCalledWith(JOB_ID, {
      kind: 'unavailable',
      offset: 20,
      limit: 100,
    });
    expect(response.json()).toEqual(value);
  });

  it.each([
    '/api/market-screens?offset=-1',
    '/api/market-screens?offset=0.5',
    '/api/market-screens?offset=9007199254740992',
    '/api/market-screens?limit=0',
    '/api/market-screens?limit=101',
    '/api/market-screens?limit=20&limit=40',
    '/api/market-screens?rootDirectory=/tmp/jobs',
    '/api/market-screens/not-a-uuid',
    `/api/market-screens/${JOB_ID}?kind=ALL`,
    `/api/market-screens/${JOB_ID}?kind=matches&kind=excluded`,
    `/api/market-screens/${JOB_ID}?offset=15001`,
    `/api/market-screens/${JOB_ID}?limit=1.5`,
    `/api/market-screens/${JOB_ID}?rootDirectory=/tmp/jobs`,
  ])('rejects invalid queries or UUIDs before store access: %s', async (url) => {
    const response = await app.inject({ method: 'GET', url });
    expect(response.statusCode).toBe(400);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(service.list).not.toHaveBeenCalled();
    expect(service.get).not.toHaveBeenCalled();
  });

  it.each(['pause', 'resume'] as const)('returns 404 for a missing job on %s', async (action) => {
    service[action].mockRejectedValue(new MarketScreenJobNotFoundError());
    const response = await app.inject({
      method: 'POST',
      url: `/api/market-screens/${JOB_ID}/${action}`,
      payload: {},
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'Market-screen job was not found.' });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('returns 404 for an unknown UUID job read', async () => {
    service.get.mockRejectedValue(new MarketScreenJobNotFoundError());
    const response = await app.inject({ method: 'GET', url: `/api/market-screens/${JOB_ID}` });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'Market-screen job was not found.' });
  });

  it.each(['pause', 'resume'] as const)(
    'allows a local browser to %s and returns its snapshot',
    async (action) => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/market-screens/${JOB_ID.toUpperCase()}/${action}`,
        headers: { origin: 'http://localhost:5100' },
        payload: {},
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(service[action]).toHaveBeenCalledWith(JOB_ID);
      expect(response.json()).toEqual(fixture());
    }
  );

  it('allows a local program without Origin or a JSON body to resume', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/market-screens/${JOB_ID}/resume`,
    });
    expect(response.statusCode).toBe(200);
    expect(service.resume).toHaveBeenCalledWith(JOB_ID);
  });

  it.each(['http://127.0.0.1:5100', 'http://[::1]:5100', 'http://localhost:5101'])(
    'accepts a default local web or same-API origin: %s',
    async (origin) => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/market-screens/${JOB_ID}/pause`,
        headers: { origin, host: 'localhost:5101' },
        payload: {},
      });
      expect(response.statusCode).toBe(200);
      expect(service.pause).toHaveBeenCalledWith(JOB_ID);
    }
  );

  it.each(['https://untrusted.invalid', 'null', 'http://localhost:5100.evil.invalid'])(
    'rejects an unrelated browser origin before mutation: %s',
    async (origin) => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/market-screens/${JOB_ID}/resume`,
        headers: { origin },
        payload: {},
      });
      expect(response.statusCode).toBe(403);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(service.resume).not.toHaveBeenCalled();
    }
  );

  it('honors an explicitly configured web origin for mutations', async () => {
    vi.stubEnv('CORS_ORIGIN', 'https://stocks.example.com');
    const allowed = await app.inject({
      method: 'POST',
      url: `/api/market-screens/${JOB_ID}/pause`,
      headers: { origin: 'https://stocks.example.com' },
      payload: {},
    });
    expect(allowed.statusCode).toBe(200);
    const rejected = await app.inject({
      method: 'POST',
      url: `/api/market-screens/${JOB_ID}/pause`,
      headers: { origin: 'http://localhost:5100' },
      payload: {},
    });
    expect(rejected.statusCode).toBe(403);
    expect(service.pause).toHaveBeenCalledTimes(1);
  });

  it('rejects extra control options in the query or body', async () => {
    for (const request of [
      { url: `/api/market-screens/${JOB_ID}/resume?concurrency=99`, payload: {} },
      { url: `/api/market-screens/${JOB_ID}/resume`, payload: { rootDirectory: '/tmp/jobs' } },
      { url: `/api/market-screens/${JOB_ID}/resume`, payload: ['resume'] },
      { url: '/api/market-screens/not-a-uuid/resume', payload: {} },
    ]) {
      expect((await app.inject({ method: 'POST', ...request })).statusCode).toBe(400);
    }
    expect(service.resume).not.toHaveBeenCalled();
  });

  it('sanitizes internal failures in both response bodies and explicit error logs', async () => {
    const error = new Error('https://provider.invalid/?token=finance-secret /Users/private/jobs');
    service.list.mockRejectedValue(error);
    service.get.mockRejectedValue(error);
    service.pause.mockRejectedValue(error);
    service.resume.mockRejectedValue(error);
    service.getPerformance.mockRejectedValue(error);
    service.refreshPerformance.mockRejectedValue(error);
    const logs = vi.spyOn(app.log, 'error');
    for (const request of [
      { method: 'GET' as const, url: '/api/market-screens' },
      { method: 'GET' as const, url: `/api/market-screens/${JOB_ID}` },
      { method: 'POST' as const, url: `/api/market-screens/${JOB_ID}/pause`, payload: {} },
      { method: 'POST' as const, url: `/api/market-screens/${JOB_ID}/resume`, payload: {} },
      { method: 'GET' as const, url: `/api/market-screens/${JOB_ID}/performance` },
      {
        method: 'POST' as const,
        url: `/api/market-screens/${JOB_ID}/performance/refresh`,
        payload: { limit: 20 },
      },
    ]) {
      const response = await app.inject(request);
      expect(response.statusCode).toBe(500);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toEqual({ error: 'Internal server error' });
      expect(response.body).not.toContain('finance-secret');
      expect(response.body).not.toContain('/Users/private');
    }
    expect(logs).toHaveBeenCalledTimes(6);
    expect(JSON.stringify(logs.mock.calls)).not.toContain('finance-secret');
    expect(JSON.stringify(logs.mock.calls)).not.toContain('/Users/private');
  });

  it.each([
    '/api/market-screens/not-a-uuid/performance',
    `/api/market-screens/${JOB_ID}/performance?offset=15001`,
    `/api/market-screens/${JOB_ID}/performance?offset=-1`,
    `/api/market-screens/${JOB_ID}/performance?offset=1.5`,
    `/api/market-screens/${JOB_ID}/performance?limit=101`,
    `/api/market-screens/${JOB_ID}/performance?limit=0`,
    `/api/market-screens/${JOB_ID}/performance?limit=20&limit=40`,
    `/api/market-screens/${JOB_ID}/performance?refresh=true`,
  ])('rejects invalid performance reads without providers or store access: %s', async (url) => {
    const response = await app.inject({ method: 'GET', url });
    expect(response.statusCode).toBe(400);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(service.getPerformance).not.toHaveBeenCalled();
    expect(service.refreshPerformance).not.toHaveBeenCalled();
    expect(service.resume).not.toHaveBeenCalled();
  });

  it('reads saved performance with defaults and null rates without starting provider updates', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/market-screens/${JOB_ID.toUpperCase()}/performance`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual(performanceFixture());
    expect(service.getPerformance).toHaveBeenCalledWith(JOB_ID, { offset: 0, limit: 20 });
    expect(service.refreshPerformance).not.toHaveBeenCalled();
    expect(service.resume).not.toHaveBeenCalled();
    expect(service.get).not.toHaveBeenCalled();
  });

  it('passes bounded saved-performance pagination', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/market-screens/${JOB_ID}/performance?offset=20&limit=100`,
    });
    expect(response.statusCode).toBe(200);
    expect(service.getPerformance).toHaveBeenCalledWith(JOB_ID, { offset: 20, limit: 100 });
  });

  it.each([undefined, {}, { limit: 50 }])(
    'starts an explicit bounded refresh and returns background progress: %j',
    async (payload) => {
      const value = performanceFixture();
      value.refresh = {
        status: 'running',
        selected: 1,
        processed: 0,
        reason: null,
      };
      service.refreshPerformance.mockResolvedValue(value);
      const response = await app.inject({
        method: 'POST',
        url: `/api/market-screens/${JOB_ID.toUpperCase()}/performance/refresh`,
        headers: { origin: 'http://localhost:5100' },
        ...(payload !== undefined ? { payload } : {}),
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toEqual(value);
      expect(service.refreshPerformance).toHaveBeenCalledWith(JOB_ID, {
        limit: payload?.limit ?? 20,
      });
      expect(service.resume).not.toHaveBeenCalled();
      expect(service.pause).not.toHaveBeenCalled();
    }
  );

  it.each([
    { limit: 0 },
    { limit: 51 },
    { limit: 1.5 },
    { limit: '20' },
    { limit: null },
    { offset: 20 },
    { rootDirectory: '/tmp/jobs' },
    { limit: 20, concurrency: 50 },
    [],
  ])('rejects invalid performance refresh bodies before provider calls: %j', async (payload) => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/market-screens/${JOB_ID}/performance/refresh`,
      payload,
    });
    expect(response.statusCode).toBe(400);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(service.refreshPerformance).not.toHaveBeenCalled();
    expect(service.resume).not.toHaveBeenCalled();
  });

  it('rejects performance refresh query controls and an unrelated browser origin', async () => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/market-screens/${JOB_ID}/performance/refresh?limit=20`,
          payload: {},
        })
      ).statusCode
    ).toBe(400);
    const response = await app.inject({
      method: 'POST',
      url: `/api/market-screens/${JOB_ID}/performance/refresh`,
      headers: { origin: 'https://untrusted.invalid' },
      payload: { limit: 20 },
    });
    expect(response.statusCode).toBe(403);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(service.refreshPerformance).not.toHaveBeenCalled();
  });

  it.each(['getPerformance', 'refreshPerformance'] as const)(
    'returns a sanitized 404 for an unknown performance job through %s',
    async (action) => {
      service[action].mockRejectedValue(new MarketScreenJobNotFoundError());
      const response = await app.inject({
        method: action === 'getPerformance' ? 'GET' : 'POST',
        url: `/api/market-screens/${JOB_ID}/performance${action === 'refreshPerformance' ? '/refresh' : ''}`,
        ...(action === 'refreshPerformance' ? { payload: {} } : {}),
      });
      expect(response.statusCode).toBe(404);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toEqual({ error: 'Market-screen job was not found.' });
    }
  );
});
