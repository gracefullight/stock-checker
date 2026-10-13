import cors from '@fastify/cors';
import Fastify from 'fastify';
import { getCorsOptions } from '@/lib/cors';
import { marketRoutes } from '@/routes/market';
import { marketScreenRoutes } from '@/routes/market-screen';
import { portfolioRoutes } from '@/routes/portfolio';
import { screenerRoutes } from '@/routes/screener';
import { watchlistRoutes } from '@/routes/watchlist';

const app = Fastify({ logger: true });

await app.register(cors, getCorsOptions());

await app.register(screenerRoutes, { prefix: '/api' });
await app.register(portfolioRoutes, { prefix: '/api' });
await app.register(watchlistRoutes, { prefix: '/api' });
await app.register(marketRoutes, { prefix: '/api' });
await app.register(marketScreenRoutes, { prefix: '/api' });

const port = Number(process.env.PORT ?? 5101);
// Loopback by default: the API has no authentication. Set API_HOST=0.0.0.0 only
// when the LAN is trusted; writes still require the dashboard origin or a local client.
const host = process.env.API_HOST?.trim() || '127.0.0.1';
await app.listen({ port, host });
