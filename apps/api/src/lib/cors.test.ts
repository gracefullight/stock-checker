import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCorsOptions } from '@/lib/cors';

describe('API CORS options', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = Fastify();
    vi.stubEnv('CORS_ORIGIN', undefined);
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it.each(['/api/portfolio/AAPL', '/api/watchlist/AAPL'])(
    'allows dashboard DELETE requests to %s without a wildcard origin',
    async (url) => {
      await app.register(cors, getCorsOptions());
      app.delete(url, async () => ({ success: true }));

      const response = await app.inject({
        method: 'OPTIONS',
        url,
        headers: {
          origin: 'http://localhost:5100',
          'access-control-request-method': 'DELETE',
        },
      });

      expect(response.statusCode).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5100');
      expect(response.headers['access-control-allow-methods']?.split(/,\s*/)).toContain('DELETE');
    }
  );

  it.each(['http://127.0.0.1:5100', 'http://[::1]:5100'])(
    'accepts the local dashboard alias %s by default',
    async (origin) => {
      await app.register(cors, getCorsOptions());
      app.get('/api/portfolio', async () => ({ assets: [] }));

      const response = await app.inject({
        method: 'GET',
        url: '/api/portfolio',
        headers: { origin },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBe(origin);
    }
  );

  it.each(['https://untrusted.invalid', 'http://192.168.1.20:5100', 'null'])(
    'does not grant CORS access to an unrelated origin: %s',
    async (origin) => {
      await app.register(cors, getCorsOptions());
      app.get('/api/portfolio', async () => ({ assets: [] }));

      const response = await app.inject({
        method: 'GET',
        url: '/api/portfolio',
        headers: { origin },
      });

      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    }
  );

  it('never emits a wildcard even when CORS_ORIGIN=*', async () => {
    vi.stubEnv('CORS_ORIGIN', '*');
    await app.register(cors, getCorsOptions());
    app.get('/api/portfolio', async () => ({ assets: [] }));

    const response = await app.inject({
      method: 'GET',
      url: '/api/portfolio',
      headers: { origin: 'https://untrusted.invalid' },
    });

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('uses the configured web origin for preflight requests', async () => {
    vi.stubEnv('CORS_ORIGIN', 'https://stocks.example.com');
    await app.register(cors, getCorsOptions());

    const response = await app.inject({
      method: 'OPTIONS',
      url: '/api/portfolio/AAPL',
      headers: {
        origin: 'https://stocks.example.com',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('https://stocks.example.com');
    expect(response.headers['access-control-allow-headers']).toBe('content-type');
  });
});
