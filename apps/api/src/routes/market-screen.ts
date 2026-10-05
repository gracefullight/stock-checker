import {
  getMarketScreenJob,
  getMarketScreenPerformance,
  listMarketScreenJobs,
  MarketScreenJobNotFoundError,
  pauseMarketScreenJob,
  refreshMarketScreenPerformance,
  runMarketScreenJob,
} from '@stock-checker/core/src/reports/market-screen';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

export interface MarketScreenApiService {
  list: typeof listMarketScreenJobs;
  get: typeof getMarketScreenJob;
  pause: typeof pauseMarketScreenJob;
  resume: typeof runMarketScreenJob;
  getPerformance: typeof getMarketScreenPerformance;
  refreshPerformance: typeof refreshMarketScreenPerformance;
}

interface MarketScreenRouteOptions {
  service?: MarketScreenApiService;
}

interface JobParams {
  jobId: string;
}

interface ListQuery {
  offset?: number;
  limit?: number;
}

interface ResultQuery extends ListQuery {
  kind?: 'matches' | 'excluded' | 'unavailable';
}

const defaultService: MarketScreenApiService = {
  list: listMarketScreenJobs,
  get: getMarketScreenJob,
  pause: pauseMarketScreenJob,
  resume: runMarketScreenJob,
  getPerformance: getMarketScreenPerformance,
  refreshPerformance: refreshMarketScreenPerformance,
};

const paginationProperties = {
  offset: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER, default: 0 },
  limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
};

const jobParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['jobId'],
  properties: {
    jobId: {
      type: 'string',
      pattern:
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
    },
  },
};

function queryGuard(allowed: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as Record<string, unknown>;
    if (
      Object.keys(query).some((key) => !allowed.includes(key)) ||
      Object.values(query).some((value) => typeof value !== 'string')
    ) {
      return reply.status(400).send({ error: 'Invalid market-screen query parameters.' });
    }
  };
}

function browserMutationAllowed(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  const configured = process.env.CORS_ORIGIN;
  if (configured && configured !== '*') return origin === configured;
  return (
    ['http://localhost:5100', 'http://127.0.0.1:5100', 'http://[::1]:5100'].includes(origin) ||
    origin === `${request.protocol}://${request.headers.host}`
  );
}

async function mutationGuard(request: FastifyRequest, reply: FastifyReply) {
  if (!browserMutationAllowed(request)) {
    return reply
      .status(403)
      .send({ error: 'This browser origin cannot control market-screen jobs.' });
  }
}

function failedRequest(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof MarketScreenJobNotFoundError) {
    return reply.status(404).send({ error: 'Market-screen job was not found.' });
  }
  request.log.error('market-screen job request failed');
  return reply.status(500).send({ error: 'Internal server error' });
}

export const marketScreenRoutes: FastifyPluginAsync<MarketScreenRouteOptions> = async (
  app,
  { service = defaultService }
) => {
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
  });

  app.setErrorHandler((error, request, reply) => {
    const statusCode =
      error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      return reply.status(statusCode).send({ error: 'Invalid market-screen request.' });
    }
    return failedRequest(error, request, reply);
  });

  app.get<{ Querystring: ListQuery }>(
    '/market-screens',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: paginationProperties,
        },
      },
      preValidation: queryGuard(['offset', 'limit']),
    },
    async (request, reply) => {
      try {
        return reply.send(await service.list(request.query));
      } catch (error) {
        return failedRequest(error, request, reply);
      }
    }
  );

  app.get<{ Params: JobParams; Querystring: ResultQuery }>(
    '/market-screens/:jobId',
    {
      schema: {
        params: jobParamsSchema,
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ...paginationProperties,
            offset: { type: 'integer', minimum: 0, maximum: 15000, default: 0 },
            kind: {
              type: 'string',
              enum: ['matches', 'excluded', 'unavailable'],
              default: 'matches',
            },
          },
        },
      },
      preValidation: queryGuard(['kind', 'offset', 'limit']),
    },
    async (request, reply) => {
      try {
        return reply.send(await service.get(request.params.jobId.toLowerCase(), request.query));
      } catch (error) {
        return failedRequest(error, request, reply);
      }
    }
  );

  app.get<{ Params: JobParams; Querystring: ListQuery }>(
    '/market-screens/:jobId/performance',
    {
      schema: {
        params: jobParamsSchema,
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ...paginationProperties,
            offset: { type: 'integer', minimum: 0, maximum: 15000, default: 0 },
          },
        },
      },
      preValidation: queryGuard(['offset', 'limit']),
    },
    async (request, reply) => {
      try {
        return reply.send(
          await service.getPerformance(request.params.jobId.toLowerCase(), request.query)
        );
      } catch (error) {
        return failedRequest(error, request, reply);
      }
    }
  );

  app.post<{ Params: JobParams }>(
    '/market-screens/:jobId/performance/refresh',
    {
      schema: {
        params: jobParamsSchema,
        querystring: { type: 'object', additionalProperties: false, properties: {} },
      },
      onRequest: mutationGuard,
      preValidation: queryGuard([]),
    },
    async (request, reply) => {
      const body = request.body;
      if (
        body !== undefined &&
        (body === null ||
          typeof body !== 'object' ||
          Array.isArray(body) ||
          Object.keys(body).some((key) => key !== 'limit') ||
          ('limit' in body &&
            (typeof body.limit !== 'number' ||
              !Number.isInteger(body.limit) ||
              body.limit < 1 ||
              body.limit > 50)))
      ) {
        return reply.status(400).send({
          error: 'Performance refresh accepts only an integer limit between 1 and 50.',
        });
      }
      const options = body as { limit?: number } | undefined;
      try {
        return reply.send(
          await service.refreshPerformance(request.params.jobId.toLowerCase(), {
            limit: options?.limit ?? 20,
          })
        );
      } catch (error) {
        return failedRequest(error, request, reply);
      }
    }
  );

  for (const action of ['pause', 'resume'] as const) {
    app.post<{ Params: JobParams }>(
      `/market-screens/:jobId/${action}`,
      {
        schema: {
          params: jobParamsSchema,
          querystring: { type: 'object', additionalProperties: false, properties: {} },
        },
        onRequest: mutationGuard,
        preValidation: queryGuard([]),
      },
      async (request, reply) => {
        const body = request.body;
        if (
          body !== undefined &&
          (body === null ||
            typeof body !== 'object' ||
            Array.isArray(body) ||
            Object.keys(body).length)
        ) {
          return reply.status(400).send({ error: 'Market-screen controls accept an empty body.' });
        }
        try {
          return reply.send(await service[action](request.params.jobId.toLowerCase()));
        } catch (error) {
          return failedRequest(error, request, reply);
        }
      }
    );
  }
};
