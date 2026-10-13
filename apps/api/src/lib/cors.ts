import type { FastifyCorsOptions } from '@fastify/cors';
import { configuredOrigin, DEFAULT_WEB_ORIGINS } from '@/lib/mutation-guard';

/**
 * Only the dashboard may call the API from a browser. CORS_ORIGIN narrows it
 * to one deployed origin; without it, the local Next.js dev/preview origins
 * are allowed. A wildcard is never emitted.
 */
export function getCorsOptions(): FastifyCorsOptions {
  return {
    origin: configuredOrigin() ?? [...DEFAULT_WEB_ORIGINS],
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
  };
}
