import type { FastifyReply, FastifyRequest } from 'fastify';

/** Default dashboard origins when CORS_ORIGIN is not configured. */
export const DEFAULT_WEB_ORIGINS = [
  'http://localhost:5100',
  'http://127.0.0.1:5100',
  'http://[::1]:5100',
] as const;

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** The single configured dashboard origin, or null when the local defaults apply. */
export function configuredOrigin(): string | null {
  const configured = process.env.CORS_ORIGIN?.trim();
  return configured && configured !== '*' ? configured : null;
}

export function isLoopbackClient(request: FastifyRequest): boolean {
  return LOOPBACK_ADDRESSES.has(request.ip);
}

/**
 * Browser writes must come from the dashboard origin (or the API's own origin).
 * Requests without an Origin header are not browser requests; they are
 * accepted only from this machine so that a device on the LAN cannot mutate
 * portfolio, watchlist or screening state even when the API is bound to a
 * non-loopback interface.
 */
export function mutationAllowed(
  request: FastifyRequest
): { allowed: true } | { allowed: false; reason: string } {
  const origin = request.headers.origin;
  if (origin === undefined) {
    return isLoopbackClient(request)
      ? { allowed: true }
      : {
          allowed: false,
          reason:
            'Writes without a browser Origin are accepted from this machine only; use the dashboard or run the request locally.',
        };
  }
  const configured = configuredOrigin();
  const allowed = configured
    ? origin === configured
    : (DEFAULT_WEB_ORIGINS as readonly string[]).includes(origin) ||
      origin === `${request.protocol}://${request.headers.host}`;
  return allowed
    ? { allowed: true }
    : {
        allowed: false,
        reason: `This browser origin cannot change state; allowed origin: ${configured ?? DEFAULT_WEB_ORIGINS[0]}.`,
      };
}

export function mutationGuardFor(subject: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const verdict = mutationAllowed(request);
    if (!verdict.allowed) {
      return reply.status(403).send({ error: `Cannot ${subject}: ${verdict.reason}` });
    }
  };
}
