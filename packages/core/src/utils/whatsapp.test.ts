import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isWhatsAppNotificationConfigured,
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
const mockFetch = (response = acceptedResponse()) =>
  vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
const sentPayload = (fetch: ReturnType<typeof mockFetch>) =>
  JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as {
    to: string;
    title: string;
    asOf: string;
    summary: string;
  };

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

describe('sendWhatsAppNotification through WhatsApp Web', () => {
  it('sends to the authenticated local gateway without Meta credentials', async () => {
    const fetch = mockFetch();
    expect(await sendWhatsAppNotification(notification, { environment, fetch })).toEqual({
      status: 'accepted',
      messageId: acceptedId,
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(
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
    expect(sentPayload(fetch)).toEqual({ to: environment.WHATSAPP_TO, ...notification });
  });

  it('uses the configured local gateway and receiver override', async () => {
    const fetch = mockFetch();
    await sendWhatsAppNotification(notification, {
      environment: {
        ...environment,
        WHATSAPP_GATEWAY_URL: 'http://localhost:55102',
        WHATSAPP_TO: '61415555555',
      },
      fetch,
    });
    expect(fetch.mock.calls[0]?.[0]).toBe('http://localhost:55102/notifications');
    expect(sentPayload(fetch).to).toBe('+61415555555');
  });

  it('reads default process configuration without caching credentials', async () => {
    for (const [key, value] of Object.entries(environment)) vi.stubEnv(key, value);
    vi.stubEnv('WHATSAPP_GATEWAY_URL', 'http://127.0.0.1:5102');
    const fetch = mockFetch();
    await sendWhatsAppNotification(notification, { fetch });
    vi.stubEnv('WHATSAPP_TO', '+61415555555');
    await sendWhatsAppNotification(notification, { fetch });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body)).to).toBe('+61415555555');
  });

  it('reads the private local token file when no explicit token is provided', async () => {
    const fetch = mockFetch();
    const readToken = vi.fn().mockResolvedValue(environment.WHATSAPP_GATEWAY_TOKEN);
    expect(
      await sendWhatsAppNotification(notification, {
        environment: { WHATSAPP_TO: environment.WHATSAPP_TO, WHATSAPP_AUTH_DIR: '/tmp/fixture-wa' },
        fetch,
        readToken,
      })
    ).toEqual({ status: 'accepted', messageId: acceptedId });
    expect(readToken).toHaveBeenCalledWith('/tmp/fixture-wa', '');
  });

  it('forwards an explicit gateway token to the token resolver', async () => {
    const readToken = vi.fn().mockResolvedValue(environment.WHATSAPP_GATEWAY_TOKEN);
    await sendWhatsAppNotification(notification, { environment, readToken, fetch: mockFetch() });
    expect(readToken.mock.calls[0]?.[1]).toBe(environment.WHATSAPP_GATEWAY_TOKEN);
  });

  it.each([
    {},
    { WHATSAPP_GATEWAY_URL: 'http://127.0.0.1:5102' },
    { WHATSAPP_ACCESS_TOKEN: 'legacy-meta-token', WHATSAPP_PHONE_NUMBER_ID: '12345' },
  ])('does not send when no receiver is configured', async (configured) => {
    const fetch = mockFetch();
    const readToken = vi.fn();
    expect(
      await sendWhatsAppNotification(notification, { environment: configured, fetch, readToken })
    ).toEqual({ status: 'disabled', reason: 'not-configured' });
    expect(fetch).not.toHaveBeenCalled();
    expect(readToken).not.toHaveBeenCalled();
  });

  it('does not generate a token or contact a gateway before local setup', async () => {
    const fetch = mockFetch();
    const readToken = vi.fn().mockResolvedValue(undefined);
    expect(
      await sendWhatsAppNotification(notification, {
        environment: { WHATSAPP_TO: environment.WHATSAPP_TO },
        fetch,
        readToken,
      })
    ).toEqual({ status: 'disabled', reason: 'not-configured' });
    expect(readToken).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not expose private token-file errors', async () => {
    const fetch = mockFetch();
    const readToken = vi.fn().mockRejectedValue(new Error('secret-token /private/auth-path'));
    expect(await sendWhatsAppNotification(notification, { environment, readToken, fetch })).toEqual(
      { status: 'disabled', reason: 'invalid-configuration' }
    );
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
    const fetch = mockFetch();
    expect(
      await sendWhatsAppNotification(notification, {
        environment: { ...environment, [key]: value },
        fetch,
      })
    ).toEqual({ status: 'disabled', reason: 'invalid-configuration' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('normalizes controls and preserves Korean text', async () => {
    const fetch = mockFetch();
    await sendWhatsAppNotification(
      {
        title: ' OII\n\t BUY\0 ',
        asOf: '\t 2026-10-05 \n',
        summary: '근거:\n \t추세\u2028전환\u200b확인',
      },
      { environment, fetch }
    );
    expect(sentPayload(fetch)).toMatchObject({
      title: 'OII BUY',
      asOf: '2026-10-05',
      summary: '근거:\n추세 전환 확인',
    });
  });

  it('bounds UTF-16 lengths without splitting supplementary characters', async () => {
    const fetch = mockFetch();
    await sendWhatsAppNotification(
      { title: `A${'😀'.repeat(100)}`, asOf: '日'.repeat(100), summary: '한국어😀'.repeat(1_000) },
      { environment, fetch }
    );
    const payload = sentPayload(fetch);
    expect(payload.title.length).toBeLessThanOrEqual(80);
    expect(payload.asOf.length).toBeLessThanOrEqual(60);
    expect(payload.summary.length).toBe(3_000);
    expect(payload.title).toBe(payload.title.toWellFormed());
    expect(payload.summary).toBe(payload.summary.toWellFormed());
  });

  it('preserves a detailed report and its historical and analyst sections in one send', async () => {
    const fetch = mockFetch();
    const summary = [
      '과거 관측값이며 미래 승률이 아닙니다.',
      `근거: ${'추세 확인 '.repeat(150).trim()}`,
      '',
      '과거 BUY 5세션: 승률 60.0%, 30건, 비용 10bps',
      '애널리스트 목표가: USD 42.00, 8명, 조회 2026-10-05',
    ].join('\n');
    expect(summary.length).toBeGreaterThan(700);
    await sendWhatsAppNotification({ ...notification, summary }, { environment, fetch });
    expect(sentPayload(fetch).summary).toBe(summary);
    expect(fetch).toHaveBeenCalledOnce();
    expect(new TextEncoder().encode(String(fetch.mock.calls[0]?.[1]?.body)).length).toBeLessThan(
      16_384
    );
  });

  it('normalizes line endings, blank lines and controls while preserving report paragraphs', async () => {
    const fetch = mockFetch();
    await sendWhatsAppNotification(
      {
        ...notification,
        summary: '  OII\r\n \t근거\0 확인  \r\n\r\n\r\n승률\u200b 표본 30\r목표가\u2028확인 ',
      },
      { environment, fetch }
    );
    expect(sentPayload(fetch).summary).toBe('OII\n근거 확인\n\n승률 표본 30\n목표가 확인');
  });

  it('uses a readable placeholder for empty notification fields', async () => {
    const fetch = mockFetch();
    await sendWhatsAppNotification(
      { title: '\n', asOf: '\t', summary: '' },
      { environment, fetch }
    );
    expect(sentPayload(fetch)).toMatchObject({ title: 'N/A', asOf: 'N/A', summary: 'N/A' });
  });

  it.each([401, 429, 503])(
    'preserves a safe HTTP %s failure without exposing details or retrying',
    async (status) => {
      const fetch = mockFetch(new Response(JSON.stringify(environment), { status }));
      expect(await sendWhatsAppNotification(notification, { environment, fetch })).toEqual({
        status: 'failed',
        reason: 'http-error',
        httpStatus: status,
      });
      expect(fetch).toHaveBeenCalledOnce();
    }
  );

  it.each([
    {},
    { messageId: null },
    { messageId: 'not-an-ack' },
    { messageId: environment.WHATSAPP_GATEWAY_TOKEN },
    { messages: [{ id: 'wamid.legacy' }] },
  ])('rejects responses without a WhatsApp Web acknowledgement', async (response) => {
    const fetch = mockFetch(new Response(JSON.stringify(response), { status: 200 }));
    expect(await sendWhatsAppNotification(notification, { environment, fetch })).toEqual({
      status: 'failed',
      reason: 'invalid-response',
    });
  });

  it('does not expose a non-JSON response', async () => {
    const fetch = mockFetch(new Response(environment.WHATSAPP_GATEWAY_TOKEN, { status: 200 }));
    expect(await sendWhatsAppNotification(notification, { environment, fetch })).toEqual({
      status: 'failed',
      reason: 'invalid-response',
    });
  });

  it('never returns a private hexadecimal token as a message acknowledgement', async () => {
    const token = 'ab'.repeat(32);
    const fetch = mockFetch(new Response(JSON.stringify({ messageId: token.toUpperCase() })));
    expect(
      await sendWhatsAppNotification(notification, {
        environment: { ...environment, WHATSAPP_GATEWAY_TOKEN: token },
        fetch,
      })
    ).toEqual({ status: 'failed', reason: 'invalid-response' });
  });

  it('does not expose an exception containing credentials or retry sending', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new Error(JSON.stringify(environment)));
    expect(await sendWhatsAppNotification(notification, { environment, fetch })).toEqual({
      status: 'failed',
      reason: 'network-error',
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('aborts a hung gateway request within ten seconds', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(() => new Promise(() => {}));
    const pending = sendWhatsAppNotification(notification, { environment, fetch });
    await vi.advanceTimersByTimeAsync(0);
    const signal = fetch.mock.calls[0]?.[1]?.signal;
    await vi.advanceTimersByTimeAsync(9_999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ status: 'failed', reason: 'network-error' });
    expect(signal?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('bounds a hung acknowledgement body read as well', async () => {
    vi.useFakeTimers();
    const response = {
      ok: true,
      json: () => new Promise(() => {}),
    } as unknown as Response;
    const fetch = mockFetch(response);
    const pending = sendWhatsAppNotification(notification, { environment, fetch });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toEqual({ status: 'failed', reason: 'network-error' });
  });

  it('cleans its timer after an accepted send', async () => {
    vi.useFakeTimers();
    const fetch = mockFetch();
    await sendWhatsAppNotification(notification, { environment, fetch });
    expect(vi.getTimerCount()).toBe(0);
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
  });
});
