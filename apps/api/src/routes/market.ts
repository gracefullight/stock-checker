import type { FastifyPluginAsync } from 'fastify';
import { cachedFearGreed } from '@/lib/cached-data';

function fearGreedLabel(v: number | null): string {
  if (v === null) return 'Unknown';
  if (v <= 25) return 'Extreme Fear';
  if (v <= 45) return 'Fear';
  if (v <= 55) return 'Neutral';
  if (v <= 75) return 'Greed';
  return 'Extreme Greed';
}

export const marketRoutes: FastifyPluginAsync = async (app) => {
  app.get('/market/fear-greed', async (req, reply) => {
    try {
      const value = await cachedFearGreed();
      const label = fearGreedLabel(value);
      return reply.send({ value, label });
    } catch (error) {
      req.log.error({ err: error }, 'fear-greed fetch failed');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
};
