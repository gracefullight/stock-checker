import { describe, expect, it } from 'vitest';
import { apiProxyRewrites, browserApiBaseUrl, resolveApiOrigin } from '@/lib/api-proxy';

describe('api proxy configuration', () => {
  it('defaults the server origin to the Fastify port and prefers API_URL', () => {
    expect(resolveApiOrigin({})).toBe('http://localhost:5101');
    expect(resolveApiOrigin({ NEXT_PUBLIC_API_URL: 'http://10.0.0.5:5101/' })).toBe(
      'http://10.0.0.5:5101'
    );
    expect(
      resolveApiOrigin({ API_URL: 'http://api.internal:5101', NEXT_PUBLIC_API_URL: 'http://x' })
    ).toBe('http://api.internal:5101');
  });

  it('uses same-origin relative URLs in the browser unless explicitly overridden', () => {
    expect(browserApiBaseUrl(undefined)).toBe('');
    expect(browserApiBaseUrl('  ')).toBe('');
    expect(browserApiBaseUrl('http://localhost:5101/')).toBe('http://localhost:5101');
  });

  it('rewrites /api/* to the API origin', () => {
    expect(apiProxyRewrites('http://localhost:5101/')).toEqual([
      { source: '/api/:path*', destination: 'http://localhost:5101/api/:path*' },
    ]);
  });
});
