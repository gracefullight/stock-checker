import type { FastifyCorsOptions } from '@fastify/cors';

export function getCorsOptions(): FastifyCorsOptions {
  return {
    origin: process.env.CORS_ORIGIN ?? '*',
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
  };
}
