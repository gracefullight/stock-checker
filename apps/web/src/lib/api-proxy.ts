/** Fastify API default (see apps/api/src/index.ts). */
export const DEFAULT_API_ORIGIN = 'http://localhost:5101';

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

/**
 * Where the Next server (SSR, rewrites) reaches the API. `API_URL` is
 * server-only; `NEXT_PUBLIC_API_URL` is honoured as a shared override.
 */
export function resolveApiOrigin(env: { API_URL?: string; NEXT_PUBLIC_API_URL?: string }): string {
  const configured = env.API_URL?.trim() || env.NEXT_PUBLIC_API_URL?.trim();
  return trimSlash(configured || DEFAULT_API_ORIGIN);
}

/**
 * Browser base URL. Empty means same-origin: `/api/*` is proxied by Next, so a
 * phone on the LAN or a non-localhost host works without a per-device env.
 * `NEXT_PUBLIC_API_URL` keeps working as an explicit cross-origin override.
 */
export function browserApiBaseUrl(publicApiUrl: string | undefined): string {
  const configured = publicApiUrl?.trim();
  return configured ? trimSlash(configured) : '';
}

/** Next.js rewrites that forward `/api/*` to the Fastify origin. */
export function apiProxyRewrites(origin: string): Array<{ source: string; destination: string }> {
  return [{ source: '/api/:path*', destination: `${trimSlash(origin)}/api/:path*` }];
}
