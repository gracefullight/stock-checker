import type { FastifyPluginAsync } from 'fastify';
import { cachedFearGreed, cachedFxRate } from '@/lib/cached-data';

function fearGreedLabel(v: number | null): string {
  if (v === null) return 'Unknown';
  if (v <= 25) return 'Extreme Fear';
  if (v <= 45) return 'Fear';
  if (v <= 55) return 'Neutral';
  if (v <= 75) return 'Greed';
  return 'Extreme Greed';
}

/** Currencies the FX endpoint serves (Yahoo `USD<CUR>=X` pairs). */
export const SUPPORTED_FX_CURRENCIES = [
  'KRW',
  'JPY',
  'EUR',
  'GBP',
  'CNY',
  'HKD',
  'TWD',
  'AUD',
  'CAD',
  'INR',
] as const;
export type SupportedFxCurrency = (typeof SUPPORTED_FX_CURRENCIES)[number];

function isSupportedCurrency(v: string): v is SupportedFxCurrency {
  return (SUPPORTED_FX_CURRENCIES as readonly string[]).includes(v);
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

  app.get<{ Querystring: { currency?: string } }>('/market/fx', async (req, reply) => {
    const currency = (req.query.currency ?? 'KRW').toUpperCase();
    if (!isSupportedCurrency(currency)) {
      return reply.status(400).send({
        error: `Unsupported currency '${currency}'. Supported: ${SUPPORTED_FX_CURRENCIES.join(', ')}`,
      });
    }
    try {
      const fx = await cachedFxRate(currency);
      if (!fx) {
        return reply.status(502).send({ error: `FX rate for ${currency} unavailable` });
      }
      return reply.send(fx);
    } catch (error) {
      req.log.error({ err: error, currency }, 'fx fetch failed');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
};
