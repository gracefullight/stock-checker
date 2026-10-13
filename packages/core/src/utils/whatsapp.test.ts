import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isWhatsAppNotificationConfigured,
  sanitizeNotificationText,
  sendWhatsAppNotification,
  type WhatsAppNotification,
} from '@/utils/whatsapp';

const notification: WhatsAppNotification = {
  title: 'Stock Checker: OII BUY',
  asOf: '2026-10-05 completed session',
  summary: 'Reference USD 32.50; score 260 is not a win probability.',
};
const environment: NodeJS.ProcessEnv = {
  WHATSAPP_GATEWAY_TOKEN: 'fixture-private-gateway-token-0123456789',
  WHATSAPP_TO: '+821012345678',
};
const acceptedId = '3EB0ABCDEF1234567890AB';
const acceptedResponse = () =>
  new Response(JSON.stringify({ messageId: acceptedId }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
const statusResponse = (state = 'connected') =>
  new Response(JSON.stringify({ state }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

type MockAnswer = (init?: RequestInit) => Promise<Response>;

interface GatewayMock {
  /** Answers for successive GET /status probes; the last entry repeats. */
  status?: Array<MockAnswer | string>;
  post?: MockAnswer;
}

/** Routes probes and sends by URL; the old single-response mock cannot serve two requests. */
function gatewayFetch(mock: GatewayMock = {}) {
  let probes = 0;
  const statuses = mock.status ?? ['connected'];
  return vi.fn<typeof globalThis.fetch>().mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith('/status') && (init?.method ?? 'GET') === 'GET') {
      const answer = statuses[Math.min(probes, statuses.length - 1)];
      probes += 1;
      return typeof answer === 'string' ? statusResponse(answer) : answer(init);
    }
    return (mock.post ?? (async () => acceptedResponse()))(init);
  });
}

/** A request that only settles when its abort signal fires, like a hung socket. */
const hung: MockAnswer = (init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });

const sentPayload = (fetch: ReturnType<typeof gatewayFetch>) => {
  const post = fetch.mock.calls.find(([, init]) => init?.method === 'POST');
  return JSON.parse(String(post?.[1]?.body)) as {
    to: string;
    title: string;
    asOf: string;
    summary: string;
  };
};
const postCalls = (fetch: ReturnType<typeof gatewayFetch>) =>
  fetch.mock.calls.filter(([, init]) => init?.method === 'POST');
const probeCalls = (fetch: ReturnType<typeof gatewayFetch>) =>
  fetch.mock.calls.filter(([url]) => String(url).endsWith('/status'));
const deps = (fetch: ReturnType<typeof gatewayFetch>, extra: Record<string, unknown> = {}) => ({
  environment,
  fetch,
  alert: vi.fn(),
  sleep: vi.fn(async (_milliseconds: number) => {}),
  ...extra,
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('isWhatsAppNotificationConfigured', () => {
  it('checks existing private configuration without creating credentials', async () => {
    const readToken = vi.fn().mockResolvedValue(environment.WHATSAPP_GATEWAY_TOKEN);
    expect(await isWhatsAppNotificationConfigured({ environment, readToken })).toBe(true);
    expect(readToken).toHaveBeenCalledOnce();
  });

  it('skips credential access when no receiver is configured', async () => {
    const readToken = vi.fn();
    expect(await isWhatsAppNotificationConfigured({ environment: {}, readToken })).toBe(false);
    expect(readToken).not.toHaveBeenCalled();
  });

  it('rejects external endpoints and private credential errors', async () => {
    const readToken = vi.fn().mockRejectedValue(new Error('private credential path and token'));
    expect(
      await isWhatsAppNotificationConfigured({
        environment: { ...environment, WHATSAPP_GATEWAY_URL: 'http://example.invalid' },
        readToken,
      })
    ).toBe(false);
    expect(readToken).not.toHaveBeenCalled();
    expect(await isWhatsAppNotificationConfigured({ environment, readToken })).toBe(false);
  });
});

describe('sanitizeNotificationText', () => {
  it('collapses controls and whitespace on one line and bounds UTF-16 length', () => {
    expect(sanitizeNotificationText(' OII\n\t BUY\0 ', 80)).toBe('OII BUY');
    expect(sanitizeNotificationText(`A${'😀'.repeat(100)}`, 7)).toBe('A😀😀😀');
    expect(sanitizeNotificationText('‮ secret', 80)).toBe('secret');
  });

  it('keeps paragraphs in multiline mode and never pads empty input', () => {
    expect(sanitizeNotificationText('  a\r\n\r\n\r\n b c ', 80, true)).toBe('a\n\nb c');
    expect(sanitizeNotificationText('\n', 80, true)).toBe('');
  });
});

describe('sendWhatsAppNotification through WhatsApp Web', () => {
  it('probes /status, then sends once to the authenticated local gateway', async () => {
    const fetch = gatewayFetch();
    const dependencies = deps(fetch);
    expect(await sendWhatsAppNotification(notification, dependencies)).toEqual({
      status: 'accepted',
      messageId: acceptedId,
    });
    expect(probeCalls(fetch)).toHaveLength(1);
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:5102/status',
      expect.objectContaining({ method: 'GET', redirect: 'error' })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:5102/notifications',
      expect.objectContaining({
        method: 'POST',
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${environment.WHATSAPP_GATEWAY_TOKEN}`,
          'Content-Type': 'application/json',
        },
        signal: expect.any(AbortSignal),
      })
    );
    expect(probeCalls(fetch)[0][1]?.headers).toBeUndefined();
    expect(sentPayload(fetch)).toEqual({ to: environment.WHATSAPP_TO, ...notification });
    expect(dependencies.sleep).not.toHaveBeenCalled();
    expect(dependencies.alert).not.toHaveBeenCalled();
  });

  it('uses the configured local gateway and receiver override', async () => {
    const fetch = gatewayFetch();
    await sendWhatsAppNotification(notification, {
      ...deps(fetch),
      environment: {
        ...environment,
        WHATSAPP_GATEWAY_URL: 'http://localhost:55102',
        WHATSAPP_TO: '61415555555',
      },
    });
    expect(fetch.mock.calls[0]?.[0]).toBe('http://localhost:55102/status');
    expect(postCalls(fetch)[0]?.[0]).toBe('http://localhost:55102/notifications');
    expect(sentPayload(fetch).to).toBe('+61415555555');
  });

  it('reads default process configuration without caching credentials', async () => {
    for (const [key, value] of Object.entries(environment)) vi.stubEnv(key, value);
    vi.stubEnv('WHATSAPP_GATEWAY_URL', 'http://127.0.0.1:5102');
    const fetch = gatewayFetch();
    await sendWhatsAppNotification(notification, { fetch, alert: vi.fn() });
    vi.stubEnv('WHATSAPP_TO', '+61415555555');
    await sendWhatsAppNotification(notification, { fetch, alert: vi.fn() });
    expect(postCalls(fetch)).toHaveLength(2);
    expect(JSON.parse(String(postCalls(fetch)[1]?.[1]?.body)).to).toBe('+61415555555');
  });

  it('reads the private local token file when no explicit token is provided', async () => {
    const fetch = gatewayFetch();
    const readToken = vi.fn().mockResolvedValue(environment.WHATSAPP_GATEWAY_TOKEN);
    expect(
      await sendWhatsAppNotification(notification, {
        ...deps(fetch),
        environment: { WHATSAPP_TO: environment.WHATSAPP_TO, WHATSAPP_AUTH_DIR: '/tmp/fixture-wa' },
        readToken,
      })
    ).toEqual({ status: 'accepted', messageId: acceptedId });
    expect(readToken).toHaveBeenCalledWith('/tmp/fixture-wa', '');
  });

  it('forwards an explicit gateway token to the token resolver', async () => {
    const readToken = vi.fn().mockResolvedValue(environment.WHATSAPP_GATEWAY_TOKEN);
    await sendWhatsAppNotification(notification, { ...deps(gatewayFetch()), readToken });
    expect(readToken.mock.calls[0]?.[1]).toBe(environment.WHATSAPP_GATEWAY_TOKEN);
  });

  it.each([
    {},
    { WHATSAPP_GATEWAY_URL: 'http://127.0.0.1:5102' },
    { WHATSAPP_ACCESS_TOKEN: 'legacy-meta-token', WHATSAPP_PHONE_NUMBER_ID: '12345' },
  ])('does not send or probe when no receiver is configured', async (configured) => {
    const fetch = gatewayFetch();
    const readToken = vi.fn();
    expect(
      await sendWhatsAppNotification(notification, {
        ...deps(fetch),
        environment: configured,
        readToken,
      })
    ).toEqual({ status: 'disabled', reason: 'not-configured' });
    expect(fetch).not.toHaveBeenCalled();
    expect(readToken).not.toHaveBeenCalled();
  });

  it('does not generate a token or contact a gateway before local setup', async () => {
    const fetch = gatewayFetch();
    const readToken = vi.fn().mockResolvedValue(undefined);
    expect(
      await sendWhatsAppNotification(notification, {
        ...deps(fetch),
        environment: { WHATSAPP_TO: environment.WHATSAPP_TO },
        readToken,
      })
    ).toEqual({ status: 'disabled', reason: 'not-configured' });
    expect(readToken).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not expose private token-file errors', async () => {
    const fetch = gatewayFetch();
    const readToken = vi.fn().mockRejectedValue(new Error('secret-token /private/auth-path'));
    expect(await sendWhatsAppNotification(notification, { ...deps(fetch), readToken })).toEqual({
      status: 'disabled',
      reason: 'invalid-configuration',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['WHATSAPP_TO', '+0123456789'],
    ['WHATSAPP_TO', '+1234567'],
    ['WHATSAPP_TO', '+8210-1234-5678'],
    ['WHATSAPP_TO', '+1234567890123456'],
    ['WHATSAPP_TO', 'https://example.invalid'],
    ['WHATSAPP_GATEWAY_TOKEN', 'short'],
    ['WHATSAPP_GATEWAY_TOKEN', 'private-token with-spaces-0123456789'],
    ['WHATSAPP_GATEWAY_TOKEN', 'private-token-0123456789\r\ninjected'],
    ['WHATSAPP_GATEWAY_URL', 'http://example.invalid:5102'],
    ['WHATSAPP_GATEWAY_URL', 'http://127.0.0.1.example.invalid:5102'],
    ['WHATSAPP_GATEWAY_URL', 'http://user:pass@127.0.0.1:5102'],
    ['WHATSAPP_GATEWAY_URL', 'http://127.0.0.1:5102/path'],
    ['WHATSAPP_GATEWAY_URL', 'http://127.0.0.1:5102/?token=secret'],
    ['WHATSAPP_GATEWAY_URL', 'http://127.0.0.1:5102/#secret'],
    ['WHATSAPP_GATEWAY_URL', 'https://127.0.0.1:5102'],
    ['WHATSAPP_GATEWAY_URL', 'not-a-url'],
  ])('prevents malformed %s configuration from sending', async (key, value) => {
    const fetch = gatewayFetch();
    expect(
      await sendWhatsAppNotification(notification, {
        ...deps(fetch),
        environment: { ...environment, [key]: value },
      })
    ).toEqual({ status: 'disabled', reason: 'invalid-configuration' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('normalizes controls and preserves Korean text', async () => {
    const fetch = gatewayFetch();
    await sendWhatsAppNotification(
      {
        title: ' OII\n\t BUY\0 ',
        asOf: '\t 2026-10-05 \n',
        summary: '근거:\n \t추세 전환​확인',
      },
      deps(fetch)
    );
    expect(sentPayload(fetch)).toMatchObject({
      title: 'OII BUY',
      asOf: '2026-10-05',
      summary: '근거:\n추세 전환 확인',
    });
  });

  it('bounds UTF-16 lengths without splitting supplementary characters', async () => {
    const fetch = gatewayFetch();
    await sendWhatsAppNotification(
      { title: `A${'😀'.repeat(100)}`, asOf: '日'.repeat(100), summary: '한국어😀'.repeat(1_000) },
      deps(fetch)
    );
    const payload = sentPayload(fetch);
    expect(payload.title.length).toBeLessThanOrEqual(80);
    expect(payload.asOf.length).toBeLessThanOrEqual(60);
    expect(payload.summary.length).toBe(3_000);
    expect(payload.title).toBe(payload.title.toWellFormed());
    expect(payload.summary).toBe(payload.summary.toWellFormed());
  });

  it('preserves a detailed report and its historical and analyst sections in one send', async () => {
    const fetch = gatewayFetch();
    const summary = [
      '과거 관측값이며 미래 승률이 아닙니다.',
      `근거: ${'추세 확인 '.repeat(150).trim()}`,
      '',
      '과거 BUY 5세션: 승률 60.0%, 30건, 비용 10bps',
      '애널리스트 목표가: USD 42.00, 8명, 조회 2026-10-05',
    ].join('\n');
    expect(summary.length).toBeGreaterThan(700);
    await sendWhatsAppNotification({ ...notification, summary }, deps(fetch));
    expect(sentPayload(fetch).summary).toBe(summary);
    expect(postCalls(fetch)).toHaveLength(1);
    expect(new TextEncoder().encode(String(postCalls(fetch)[0]?.[1]?.body)).length).toBeLessThan(
      16_384
    );
  });

  it('normalizes line endings, blank lines and controls while preserving report paragraphs', async () => {
    const fetch = gatewayFetch();
    await sendWhatsAppNotification(
      {
        ...notification,
        summary: '  OII\r\n \t근거\0 확인  \r\n\r\n\r\n승률​ 표본 30\r목표가 확인 ',
      },
      deps(fetch)
    );
    expect(sentPayload(fetch).summary).toBe('OII\n근거 확인\n\n승률 표본 30\n목표가 확인');
  });

  it('uses a readable placeholder for empty notification fields', async () => {
    const fetch = gatewayFetch();
    await sendWhatsAppNotification({ title: '\n', asOf: '\t', summary: '' }, deps(fetch));
    expect(sentPayload(fetch)).toMatchObject({ title: 'N/A', asOf: 'N/A', summary: 'N/A' });
  });

  it.each([401, 429, 503])(
    'preserves a safe HTTP %s failure without exposing details or retrying',
    async (status) => {
      const fetch = gatewayFetch({
        post: async () => new Response(JSON.stringify(environment), { status }),
      });
      const dependencies = deps(fetch);
      expect(await sendWhatsAppNotification(notification, dependencies)).toEqual({
        status: 'failed',
        reason: 'http-error',
        httpStatus: status,
      });
      expect(postCalls(fetch)).toHaveLength(1);
      expect(dependencies.alert).toHaveBeenCalledOnce();
      const alert = dependencies.alert.mock.calls[0][0] as { title: string; body: string };
      expect(alert.body).toContain(`HTTP ${status}`);
      expect(JSON.stringify(alert)).not.toContain(environment.WHATSAPP_GATEWAY_TOKEN);
    }
  );

  it.each([
    {},
    { messageId: null },
    { messageId: 'not-an-ack' },
    { messageId: environment.WHATSAPP_GATEWAY_TOKEN },
    { messages: [{ id: 'wamid.legacy' }] },
  ])('rejects responses without a WhatsApp Web acknowledgement', async (response) => {
    const fetch = gatewayFetch({
      post: async () => new Response(JSON.stringify(response), { status: 200 }),
    });
    expect(await sendWhatsAppNotification(notification, deps(fetch))).toEqual({
      status: 'failed',
      reason: 'invalid-response',
    });
  });

  it('does not expose a non-JSON response', async () => {
    const fetch = gatewayFetch({
      post: async () => new Response(environment.WHATSAPP_GATEWAY_TOKEN, { status: 200 }),
    });
    expect(await sendWhatsAppNotification(notification, deps(fetch))).toEqual({
      status: 'failed',
      reason: 'invalid-response',
    });
  });

  it('never returns a private hexadecimal token as a message acknowledgement', async () => {
    const token = 'ab'.repeat(32);
    const fetch = gatewayFetch({
      post: async () => new Response(JSON.stringify({ messageId: token.toUpperCase() })),
    });
    expect(
      await sendWhatsAppNotification(notification, {
        ...deps(fetch),
        environment: { ...environment, WHATSAPP_GATEWAY_TOKEN: token },
      })
    ).toEqual({ status: 'failed', reason: 'invalid-response' });
  });

  it('does not expose an exception containing credentials or retry a posted send', async () => {
    const fetch = gatewayFetch({
      post: () => Promise.reject(new Error(JSON.stringify(environment))),
    });
    const dependencies = deps(fetch);
    expect(await sendWhatsAppNotification(notification, dependencies)).toEqual({
      status: 'failed',
      reason: 'network-error',
    });
    expect(postCalls(fetch)).toHaveLength(1);
    expect(dependencies.sleep).not.toHaveBeenCalled();
  });

  it('aborts a hung gateway send within ten seconds and never re-posts', async () => {
    vi.useFakeTimers();
    const fetch = gatewayFetch({ post: hung });
    const pending = sendWhatsAppNotification(notification, deps(fetch));
    await vi.advanceTimersByTimeAsync(0);
    const signal = postCalls(fetch)[0]?.[1]?.signal;
    await vi.advanceTimersByTimeAsync(9_999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ status: 'failed', reason: 'network-error' });
    expect(signal?.aborted).toBe(true);
    expect(postCalls(fetch)).toHaveLength(1);
  });

  it('bounds a hung acknowledgement body read as well', async () => {
    vi.useFakeTimers();
    const response = { ok: true, json: () => new Promise(() => {}) } as unknown as Response;
    const fetch = gatewayFetch({ post: async () => response });
    const pending = sendWhatsAppNotification(notification, deps(fetch));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toEqual({ status: 'failed', reason: 'network-error' });
  });

  it('cleans its timers after an accepted send', async () => {
    vi.useFakeTimers();
    const fetch = gatewayFetch();
    await sendWhatsAppNotification(notification, deps(fetch));
    expect(vi.getTimerCount()).toBe(0);
    expect(postCalls(fetch)[0]?.[1]?.signal?.aborted).toBe(false);
  });

  describe('definite non-sends are retried before any POST', () => {
    it('re-probes an unreachable gateway at 60/120/420 s and then gives up without posting', async () => {
      const fetch = gatewayFetch({
        status: [() => Promise.reject(new Error('ECONNREFUSED 127.0.0.1:5102'))],
      });
      const dependencies = deps(fetch);
      expect(await sendWhatsAppNotification(notification, dependencies)).toEqual({
        status: 'failed',
        reason: 'gateway-unreachable',
        probes: 4,
      });
      expect(dependencies.sleep.mock.calls.map(([ms]) => ms)).toEqual([60_000, 120_000, 420_000]);
      expect(probeCalls(fetch)).toHaveLength(4);
      expect(postCalls(fetch)).toHaveLength(0);
      expect(dependencies.alert).toHaveBeenCalledOnce();
      expect(dependencies.alert.mock.calls[0][0]).toMatchObject({
        title: expect.stringContaining('WhatsApp'),
        body: expect.stringContaining('연결할 수 없어'),
      });
    });

    it('waits for a reconnecting session and sends once it reports connected', async () => {
      const fetch = gatewayFetch({ status: ['disconnected', 'linking', 'connected'] });
      const dependencies = deps(fetch);
      expect(await sendWhatsAppNotification(notification, dependencies)).toEqual({
        status: 'accepted',
        messageId: acceptedId,
      });
      expect(dependencies.sleep.mock.calls.map(([ms]) => ms)).toEqual([60_000, 120_000]);
      expect(probeCalls(fetch)).toHaveLength(3);
      expect(postCalls(fetch)).toHaveLength(1);
      expect(dependencies.alert).not.toHaveBeenCalled();
    });

    it('reports the session state when it never reconnects', async () => {
      const fetch = gatewayFetch({ status: ['logged-out'] });
      const dependencies = deps(fetch);
      expect(await sendWhatsAppNotification(notification, dependencies)).toEqual({
        status: 'failed',
        reason: 'session-not-connected',
        sessionState: 'logged-out',
        probes: 4,
      });
      expect(postCalls(fetch)).toHaveLength(0);
      expect(dependencies.alert.mock.calls[0][0]).toMatchObject({
        body: expect.stringContaining("'logged-out'"),
      });
    });

    it('treats a probe that times out as unreachable', async () => {
      vi.useFakeTimers();
      const fetch = gatewayFetch({ status: [hung] });
      const pending = sendWhatsAppNotification(notification, {
        ...deps(fetch),
        probeDelaysMs: [],
      });
      await vi.advanceTimersByTimeAsync(4_999);
      expect(probeCalls(fetch)[0]?.[1]?.signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toEqual({
        status: 'failed',
        reason: 'gateway-unreachable',
        probes: 1,
      });
      expect(postCalls(fetch)).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('still posts when an older gateway answers /status without a readable state', async () => {
      const fetch = gatewayFetch({
        status: [async () => new Response('not found', { status: 404 })],
      });
      const dependencies = deps(fetch);
      expect(await sendWhatsAppNotification(notification, dependencies)).toEqual({
        status: 'accepted',
        messageId: acceptedId,
      });
      expect(probeCalls(fetch)).toHaveLength(1);
      expect(dependencies.sleep).not.toHaveBeenCalled();
    });

    it('never lets a throwing alert hook change the send result', async () => {
      const fetch = gatewayFetch({ status: ['disconnected'] });
      expect(
        await sendWhatsAppNotification(notification, {
          ...deps(fetch),
          probeDelaysMs: [],
          alert: () => {
            throw new Error('osascript missing');
          },
        })
      ).toMatchObject({ status: 'failed', reason: 'session-not-connected' });
    });
  });
});
