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
    'allows browser DELETE requests to %s',
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
      expect(response.headers['access-control-allow-origin']).toBe('*');
      expect(response.headers['access-control-allow-methods']?.split(/,\s*/)).toContain('DELETE');
    }
  );

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
