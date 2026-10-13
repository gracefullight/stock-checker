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
import { mutationGuardFor } from '@/lib/mutation-guard';

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

interface JobListQuery extends ListQuery {
  /** Deep link: pin this job first in the page so /market-screen?job=<id> can select it. */
  job?: string;
}

const JOB_ID_PATTERN =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';

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
    jobId: { type: 'string', pattern: JOB_ID_PATTERN },
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

const mutationGuard = mutationGuardFor('control market-screen jobs');

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

  app.get<{ Querystring: JobListQuery }>(
    '/market-screens',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ...paginationProperties,
            job: { type: 'string', pattern: JOB_ID_PATTERN },
          },
        },
      },
      preValidation: queryGuard(['offset', 'limit', 'job']),
    },
    async (request, reply) => {
      try {
        const { job, offset, limit } = request.query;
        const list = await service.list({ offset, limit });
        if (!job) return reply.send(list);
        // Deep link: make sure the requested job is on the page and first, so the
        // dashboard can select it without paging through the store.
        const id = job.toLowerCase();
        const selected =
          list.jobs.find((saved) => saved.id === id) ??
          (await service.get(id, { kind: 'matches', offset: 0, limit: 1 })).job;
        const jobs = [selected, ...list.jobs.filter((saved) => saved.id !== id)].slice(
          0,
          list.limit
        );
        return reply.send({ ...list, jobs, selectedJobId: id });
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
