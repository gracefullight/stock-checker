import cors from '@fastify/cors';
import Fastify from 'fastify';
import { marketRoutes } from '@/routes/market';
import { portfolioRoutes } from '@/routes/portfolio';
import { screenerRoutes } from '@/routes/screener';

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: process.env.CORS_ORIGIN ?? '*',
});

await app.register(screenerRoutes, { prefix: '/api' });
await app.register(portfolioRoutes, { prefix: '/api' });
await app.register(marketRoutes, { prefix: '/api' });

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: '0.0.0.0' });
