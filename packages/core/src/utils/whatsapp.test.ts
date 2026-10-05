import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendWhatsAppNotification, type WhatsAppNotification } from '@/utils/whatsapp';

const notification: WhatsAppNotification = {
  title: 'Stock Checker: OII BUY',
  asOf: '2026-10-05 completed session',
  summary: 'Reference USD 32.50; score 260 is not a win probability.',
};
const environment: NodeJS.ProcessEnv = {
  WHATSAPP_ACCESS_TOKEN: 'fixture-private-access-token',
  WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
  WHATSAPP_TO: '+821012345678',
  WHATSAPP_TEMPLATE_NAME: 'stock_checker_alert',
  WHATSAPP_GRAPH_API_VERSION: 'v26.0',
};
const acceptedId = 'wamid.HBgMNDgwMDAwMDAwMDAwFQIAERgSQUJDMTIz';

function acceptedResponse() {
  return new Response(
    JSON.stringify({ messaging_product: 'whatsapp', messages: [{ id: acceptedId }] }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

function mockFetch(response = acceptedResponse()) {
  return vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
}

function sentPayload(fetch: ReturnType<typeof mockFetch>) {
  return JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as {
    messaging_product: string;
    recipient_type: string;
    to: string;
    type: string;
    template: {
      name: string;
      language: { code: string };
      components: { type: string; parameters: { type: string; text: string }[] }[];
    };
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('sendWhatsAppNotification', () => {
  it('posts exactly three body text variables to the configured Graph version', async () => {
    const fetch = mockFetch();
    expect(await sendWhatsAppNotification(notification, { environment, fetch })).toEqual({
      status: 'accepted',
      messageId: acceptedId,
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(
      'https://graph.facebook.com/v26.0/123456789012345/messages',
      expect.objectContaining({
        method: 'POST',
        redirect: 'error',
        headers: {
          Authorization: 'Bearer fixture-private-access-token',
          'Content-Type': 'application/json',
        },
        signal: expect.any(AbortSignal),
      })
    );
    expect(sentPayload(fetch)).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '821012345678',
      type: 'template',
      template: {
        name: 'stock_checker_alert',
        language: { code: 'en_US' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: notification.title },
              { type: 'text', text: notification.asOf },
              { type: 'text', text: notification.summary },
            ],
          },
        ],
      },
    });
  });

  it('supports configured language codes and recipients without a leading plus', async () => {
    const fetch = mockFetch();
    const configured = {
      ...environment,
      WHATSAPP_TO: '821012345678',
      WHATSAPP_TEMPLATE_LANGUAGE: 'ko',
    };
    expect(
      await sendWhatsAppNotification(notification, { environment: configured, fetch })
    ).toEqual({
      status: 'accepted',
      messageId: acceptedId,
    });
    expect(sentPayload(fetch).template.language.code).toBe('ko');
    expect(sentPayload(fetch).to).toBe('821012345678');
  });

  it('uses process environment by default without exposing it in the result', async () => {
    for (const [key, value] of Object.entries(environment)) vi.stubEnv(key, value);
    vi.stubEnv('WHATSAPP_TEMPLATE_LANGUAGE', 'en_US');
    const fetch = mockFetch();
    expect(await sendWhatsAppNotification(notification, { fetch })).toEqual({
      status: 'accepted',
      messageId: acceptedId,
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('disables sending when no WhatsApp values are configured', async () => {
    const fetch = mockFetch();
    expect(
      await sendWhatsAppNotification(notification, { environment: { NODE_ENV: 'test' }, fetch })
    ).toEqual({
      status: 'disabled',
      reason: 'not-configured',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('disables incomplete configuration instead of calling the provider', async () => {
    const fetch = mockFetch();
    expect(
      await sendWhatsAppNotification(notification, {
        environment: { WHATSAPP_ACCESS_TOKEN: 'fixture-private-access-token' },
        fetch,
      })
    ).toEqual({ status: 'disabled', reason: 'invalid-configuration' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not enable notifications merely because the optional locale is set', async () => {
    const fetch = mockFetch();
    expect(
      await sendWhatsAppNotification(notification, {
        environment: { WHATSAPP_TEMPLATE_LANGUAGE: 'en_US' },
        fetch,
      })
    ).toEqual({ status: 'disabled', reason: 'not-configured' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['', '   '])(
    'defaults an empty locale to en_US, including unset CI variables',
    async (locale) => {
      const fetch = mockFetch();
      await sendWhatsAppNotification(notification, {
        environment: { ...environment, WHATSAPP_TEMPLATE_LANGUAGE: locale },
        fetch,
      });
      expect(sentPayload(fetch).template.language.code).toBe('en_US');
    }
  );

  it.each([
    ['WHATSAPP_ACCESS_TOKEN', ''],
    ['WHATSAPP_ACCESS_TOKEN', 'token\r\ninjected'],
    ['WHATSAPP_ACCESS_TOKEN', 'token with spaces'],
    ['WHATSAPP_PHONE_NUMBER_ID', '123/../../messages'],
    ['WHATSAPP_PHONE_NUMBER_ID', 'phone-id'],
    ['WHATSAPP_TO', '+0123456789'],
    ['WHATSAPP_TO', '+8210-1234-5678'],
    ['WHATSAPP_TO', '+1234567890123456'],
    ['WHATSAPP_TO', 'https://example.invalid'],
    ['WHATSAPP_TEMPLATE_NAME', 'Invalid-Template'],
    ['WHATSAPP_TEMPLATE_NAME', ''],
    ['WHATSAPP_TEMPLATE_LANGUAGE', 'en-US'],
    ['WHATSAPP_TEMPLATE_LANGUAGE', 'en_US\nextra'],
    ['WHATSAPP_GRAPH_API_VERSION', ''],
    ['WHATSAPP_GRAPH_API_VERSION', 'latest'],
    ['WHATSAPP_GRAPH_API_VERSION', 'v0.0'],
    ['WHATSAPP_GRAPH_API_VERSION', 'v26.0/messages?access_token=fixture'],
  ])('disables malformed %s=%s without a request', async (key, value) => {
    const fetch = mockFetch();
    expect(
      await sendWhatsAppNotification(notification, {
        environment: { ...environment, [key]: value },
        fetch,
      })
    ).toEqual({
      status: 'disabled',
      reason: 'invalid-configuration',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('requires the Graph version explicitly instead of selecting a default', async () => {
    const fetch = mockFetch();
    const configured = { ...environment };
    delete configured.WHATSAPP_GRAPH_API_VERSION;
    expect(
      await sendWhatsAppNotification(notification, { environment: configured, fetch })
    ).toEqual({
      status: 'disabled',
      reason: 'invalid-configuration',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('removes controls and collapses whitespace in the three template parameters', async () => {
    const fetch = mockFetch();
    await sendWhatsAppNotification(
      {
        title: ' OII\n\t BUY\0 ',
        asOf: '\r 2026-10-05\u2028 UTC ',
        summary: 'USD\u200e 32.50\u2029   completed\u001b session',
      },
      { environment, fetch }
    );
    expect(
      sentPayload(fetch).template.components[0]?.parameters.map((parameter) => parameter.text)
    ).toEqual(['OII BUY', '2026-10-05 UTC', 'USD 32.50 completed session']);
  });

  it('bounds all text without splitting Unicode and keeps the combined parameters below 1024', async () => {
    const fetch = mockFetch();
    await sendWhatsAppNotification(
      { title: `A${'😀'.repeat(100)}`, asOf: '日'.repeat(100), summary: '한국어😀'.repeat(500) },
      { environment, fetch }
    );
    const texts =
      sentPayload(fetch).template.components[0]?.parameters.map((parameter) => parameter.text) ??
      [];
    expect(texts).toHaveLength(3);
    expect(texts[0]?.length).toBe(79);
    expect(texts[1]?.length).toBe(60);
    expect(texts[2]?.length).toBeLessThanOrEqual(700);
    expect(texts.reduce((sum, text) => sum + text.length, 0)).toBeLessThan(1024);
    expect(texts.every((text) => text.isWellFormed())).toBe(true);
  });

  it('uses N/A for empty template parameters', async () => {
    const fetch = mockFetch();
    await sendWhatsAppNotification(
      { title: '\n', asOf: '\t', summary: '' },
      { environment, fetch }
    );
    expect(
      sentPayload(fetch).template.components[0]?.parameters.map((parameter) => parameter.text)
    ).toEqual(['N/A', 'N/A', 'N/A']);
  });

  it('returns only an HTTP status for provider failures and never retries', async () => {
    const secretBody = JSON.stringify({
      error: { message: `${environment.WHATSAPP_ACCESS_TOKEN} ${environment.WHATSAPP_TO}` },
    });
    const response = new Response(secretBody, { status: 429 });
    const json = vi.spyOn(response, 'json');
    const fetch = mockFetch(response);
    expect(await sendWhatsAppNotification(notification, { environment, fetch })).toEqual({
      status: 'failed',
      reason: 'http-error',
      httpStatus: 429,
    });
    expect(json).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    null,
    {},
    { messages: [] },
    { messages: [{ id: 'unprefixed' }] },
    { messages: [{ id: 'wamid.' }] },
    { messages: [{ id: 'wamid.line\nbreak' }] },
    { messages: [{ id: 123 }] },
    { messages: [{ id: acceptedId }, { id: acceptedId }] },
  ])('rejects an invalid provider acknowledgement: %j', async (data) => {
    const fetch = mockFetch(new Response(JSON.stringify(data), { status: 200 }));
    expect(await sendWhatsAppNotification(notification, { environment, fetch })).toEqual({
      status: 'failed',
      reason: 'invalid-response',
    });
  });

  it('handles a non-JSON successful response without throwing or exposing the body', async () => {
    const fetch = mockFetch(new Response(environment.WHATSAPP_ACCESS_TOKEN, { status: 200 }));
    expect(await sendWhatsAppNotification(notification, { environment, fetch })).toEqual({
      status: 'failed',
      reason: 'invalid-response',
    });
  });

  it('returns a generic network failure without logging or leaking exception contents', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(
        new Error(`Bearer ${environment.WHATSAPP_ACCESS_TOKEN}; to ${environment.WHATSAPP_TO}`)
      );
    expect(await sendWhatsAppNotification(notification, { environment, fetch })).toEqual({
      status: 'failed',
      reason: 'network-error',
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('aborts and returns after ten seconds even when an injected fetch ignores cancellation', async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(() => new Promise(() => undefined));
    const pending = sendWhatsAppNotification(notification, { environment, fetch });
    const signal = fetch.mock.calls[0]?.[1]?.signal;
    await vi.advanceTimersByTimeAsync(9_999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ status: 'failed', reason: 'network-error' });
    expect(signal?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds successful HTTP responses whose JSON body never finishes reading', async () => {
    vi.useFakeTimers();
    const response = acceptedResponse();
    vi.spyOn(response, 'json').mockImplementation(() => new Promise(() => undefined));
    const fetch = mockFetch(response);
    const pending = sendWhatsAppNotification(notification, { environment, fetch });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toEqual({ status: 'failed', reason: 'network-error' });
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the timeout when the provider acknowledges the message', async () => {
    vi.useFakeTimers();
    const fetch = mockFetch();
    await sendWhatsAppNotification(notification, { environment, fetch });
    expect(vi.getTimerCount()).toBe(0);
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
  });
});
