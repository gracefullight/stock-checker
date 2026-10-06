import { type IncomingHttpHeaders, request } from 'node:http';
import QRCode from 'qrcode';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWhatsAppGateway, isAllowedGatewayRequest } from './gateway.ts';
import type { WhatsAppSession, WhatsAppSessionState } from './session.ts';

const TOKEN = 'test-only-gateway-token-0123456789abcdef';
const MESSAGE_ID = '3EB0123456789ABCDEF1234';
const PAYLOAD = {
  to: '+15555550123',
  title: 'Stock Checker: AAPL HOLD',
  asOf: '2026-10-05',
  summary: 'Historical win rate unavailable. No entry suggested.',
};
const AUTHORIZATION = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };

interface HttpResult {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

let state: WhatsAppSessionState;
let qr: string | null;
let session: Pick<WhatsAppSession, 'state' | 'sendText'>;
let sendText: ReturnType<typeof vi.fn<WhatsAppSession['sendText']>>;
let gateway: ReturnType<typeof createWhatsAppGateway>;
let port: number;

function call(
  pathname: string,
  method = 'GET',
  headers: Record<string, string | undefined> = {},
  body?: string | Buffer
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const client = request(
      {
        hostname: '127.0.0.1',
        port,
        path: pathname,
        method,
        headers: { host: `127.0.0.1:${port}`, ...headers },
        setHost: false,
        agent: false,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.once('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          })
        );
        response.once('error', reject);
      }
    );
    client.once('error', reject);
    client.setTimeout(2000, () => client.destroy(new Error('Offline HTTP fixture timed out')));
    client.end(body);
  });
}

beforeEach(async () => {
  state = 'connected';
  qr = null;
  sendText = vi
    .fn<WhatsAppSession['sendText']>()
    .mockResolvedValue({ status: 'accepted', messageId: MESSAGE_ID });
  session = {
    get state() {
      return state;
    },
    sendText,
  };
  gateway = createWhatsAppGateway({
    session,
    token: TOKEN,
    getQr: () => qr,
    port: 0,
    bodyTimeoutMs: 50,
    sendTimeoutMs: 50,
  });
  port = (await gateway.start()).port;
});

afterEach(async () => {
  await gateway.stop();
  vi.restoreAllMocks();
});

describe('local WhatsApp gateway', () => {
  it('reports expired phone pairing and directs an explicit manual service restart for a fresh QR', async () => {
    state = 'pairing-expired';
    qr = 'stale-private-pairing-fixture';
    expect(JSON.parse((await call('/status')).body.toString())).toEqual({
      state: 'pairing-expired',
    });
    const html = (await call('/')).body.toString();
    expect(html).toContain('휴대폰 연결 대기 시간이 만료됐습니다');
    expect(html).toContain('mise run whatsapp:service:restart');
    expect(html).toContain('새 QR');
    expect(html).not.toContain('QR 코드가 준비되면 자동으로 표시됩니다');
    expect(html).not.toContain('src="/qr"');
    expect(html).not.toContain(qr);
    expect((await call('/qr')).status).toBe(503);
    expect(sendText).not.toHaveBeenCalled();
  });

  it('keeps disconnected guidance about the network and manual restart without promising a new QR', async () => {
    state = 'disconnected';
    qr = 'stale-private-pairing-fixture';
    const html = (await call('/')).body.toString();
    expect(html).toContain('네트워크');
    expect(html).toContain('mise run whatsapp:service:restart');
    expect(html).not.toContain('QR 코드가 준비되면 자동으로 표시됩니다');
    expect(html).not.toContain('src="/qr"');
    expect(html).not.toContain('대기 시간이 만료');
    expect(sendText).not.toHaveBeenCalled();
  });

  it('guides an unlinked service to explicit pairing and stops it before a foreground gateway', async () => {
    state = 'unlinked';
    const html = (await call('/')).body.toString();
    expect(html).toContain('mise run whatsapp:service:install -- --link');
    expect(html).toContain('mise run whatsapp:service:stop');
    expect(html).toContain('mise run whatsapp:link');
    expect(sendText).not.toHaveBeenCalled();
  });

  it.each(['unlinked', 'connected', 'disconnected', 'logged-out'] as const)(
    'does not display a QR image or waiting promise while %s even with a stale QR',
    async (currentState) => {
      state = currentState;
      qr = 'stale-private-pairing-fixture';
      const html = (await call('/')).body.toString();
      expect(html).not.toContain('QR 코드가 준비되면 자동으로 표시됩니다');
      expect(html).not.toContain('src="/qr"');
      expect(html).not.toContain(qr);
      expect((await call('/qr')).status).toBe(503);
      expect(sendText).not.toHaveBeenCalled();
    }
  );

  it('keeps the waiting placeholder only while a linking session has no QR yet', async () => {
    state = 'linking';
    const html = (await call('/')).body.toString();
    expect(html).toContain('QR 코드가 준비되면 자동으로 표시됩니다');
    expect(html).not.toContain('src="/qr"');
    expect((await call('/qr')).status).toBe(503);
    expect(sendText).not.toHaveBeenCalled();
  });

  it('guides logged-out sessions to a new private directory shared with notification callers', async () => {
    state = 'logged-out';
    const html = (await call('/')).body.toString();
    expect(html).toContain('새 비공개 WHATSAPP_AUTH_DIR');
    expect(html).toContain('API와 MCP에도 같은 새 경로');
    expect(sendText).not.toHaveBeenCalled();
  });

  it('binds IPv4 loopback and returns only a safe session state', async () => {
    expect(gateway.server.address()).toMatchObject({ address: '127.0.0.1' });
    qr = 'private-pairing-fixture';
    state = 'linking';
    const response = await call('/status');
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body.toString())).toEqual({ state: 'linking' });
    expect(response.body.toString()).not.toContain(qr);
    expect(sendText).not.toHaveBeenCalled();
  });

  it('serves a Korean refreshing QR page without embedding QR or credentials', async () => {
    state = 'linking';
    qr = 'private-pairing-fixture';
    const response = await call('/');
    const html = response.body.toString();
    expect(response.status).toBe(200);
    expect(html).toContain('연결된 기기');
    expect(html).toContain('http-equiv="refresh"');
    expect(html).toContain('src="/qr"');
    expect(html).not.toContain(qr);
    expect(html).not.toContain(TOKEN);
    expect(html).not.toContain(PAYLOAD.to);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(sendText).not.toHaveBeenCalled();
  });

  it('serves a PNG QR only while linking and never includes its raw value', async () => {
    state = 'linking';
    qr = 'private-pairing-fixture';
    const response = await call('/qr');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.body.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(response.body.toString()).not.toContain(qr);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(sendText).not.toHaveBeenCalled();
    state = 'connected';
    expect((await call('/qr')).status).toBe(503);
  });

  it('rejects a QR image if its registration secret changed during encoding', async () => {
    state = 'linking';
    qr = 'private-retired-pairing-fixture';
    const encoding = Promise.withResolvers<Buffer>();
    const started = Promise.withResolvers<void>();
    vi.spyOn(QRCode, 'toBuffer').mockImplementationOnce(() => {
      started.resolve();
      return encoding.promise;
    });
    const response = call('/qr');
    await started.promise;
    qr = 'private-fresh-pairing-fixture';
    encoding.resolve(Buffer.from('retired-image-fixture'));
    const result = await response;
    expect(result.status).toBe(503);
    expect(JSON.parse(result.body.toString())).toEqual({ error: 'qr-unavailable' });
    expect(result.body.toString()).not.toContain('retired-image-fixture');
    expect(result.body.toString()).not.toContain(qr);
    expect(sendText).not.toHaveBeenCalled();
  });

  it.each(['connected', 'pairing-expired'] as const)(
    'rejects a pending QR image after the session becomes %s',
    async (nextState) => {
      state = 'linking';
      qr = 'private-pairing-fixture';
      const encoding = Promise.withResolvers<Buffer>();
      const started = Promise.withResolvers<void>();
      vi.spyOn(QRCode, 'toBuffer').mockImplementationOnce(() => {
        started.resolve();
        return encoding.promise;
      });
      const response = call('/qr');
      await started.promise;
      state = nextState;
      encoding.resolve(Buffer.from('obsolete-image-fixture'));
      const result = await response;
      expect(result.status).toBe(503);
      expect(JSON.parse(result.body.toString())).toEqual({ error: 'qr-unavailable' });
      expect(result.body.toString()).not.toContain('obsolete-image-fixture');
      expect(result.body.toString()).not.toContain(qr);
      expect(sendText).not.toHaveBeenCalled();
    }
  );

  it('keeps an unlinked default page free of pairing or sending side effects', async () => {
    state = 'unlinked';
    expect((await call('/')).body.toString()).toContain('연결되지 않았습니다');
    expect((await call('/qr')).status).toBe(503);
    expect(sendText).not.toHaveBeenCalled();
  });

  it.each([
    { host: 'attacker.example' },
    { host: 'localhost.attacker.example' },
    { host: '127.0.0.1:80' },
    { host: '' },
    { origin: 'https://attacker.example' },
    { origin: 'null' },
    { 'sec-fetch-site': 'cross-site' },
    { 'sec-fetch-site': 'same-site' },
  ])('blocks browser and Host attacks on GET and POST: %o', async (headers) => {
    expect((await call('/qr', 'GET', headers)).status).toBe(403);
    expect(
      (
        await call(
          '/notifications',
          'POST',
          { ...AUTHORIZATION, ...headers },
          JSON.stringify(PAYLOAD)
        )
      ).status
    ).toBe(403);
    expect(sendText).not.toHaveBeenCalled();
  });

  it('allows only the actual same-origin address for browser access', async () => {
    expect(
      (
        await call('/status', 'GET', {
          origin: `http://127.0.0.1:${port}`,
          'sec-fetch-site': 'same-origin',
        })
      ).status
    ).toBe(200);
    expect(
      (
        await call('/status', 'GET', {
          host: `localhost:${port}`,
          origin: `http://localhost:${port}`,
          'sec-fetch-site': 'none',
        })
      ).status
    ).toBe(200);
    expect((await call('/status', 'GET', { origin: `http://localhost:${port}` })).status).toBe(403);
  });

  it('accepts the normalized Host and Origin of an HTTP default-port URL', () => {
    for (const hostname of ['127.0.0.1', 'localhost']) {
      const origin = new URL(`http://${hostname}:80`).origin;
      expect(isAllowedGatewayRequest({ headers: { host: hostname, origin } }, 80)).toBe(true);
      expect(isAllowedGatewayRequest({ headers: { host: `${hostname}:80`, origin } }, 80)).toBe(
        true
      );
      expect(isAllowedGatewayRequest({ headers: { host: hostname, origin } }, 5102)).toBe(false);
    }
  });

  it.each([undefined, 'Bearer short', `Bearer ${'x'.repeat(64)}`, `Basic ${TOKEN}`])(
    'requires bearer authentication before reading a notification: %s',
    async (authorization) => {
      const headers = authorization ? { authorization } : {};
      const response = await call('/notifications', 'POST', headers, 'malformed');
      expect(response.status).toBe(401);
      expect(response.body.toString()).not.toContain(TOKEN);
      expect(sendText).not.toHaveBeenCalled();
    }
  );

  it('submits one validated notification and returns only its message ID', async () => {
    const payload = {
      ...PAYLOAD,
      summary: '*AAPL · HOLD*\n승률: 자료 없음\n\n근거: 신규 진입 보류',
    };
    const response = await call('/notifications', 'POST', AUTHORIZATION, JSON.stringify(payload));
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body.toString())).toEqual({ messageId: MESSAGE_ID });
    expect(sendText).toHaveBeenCalledExactlyOnceWith(
      PAYLOAD.to,
      `*${payload.title}*\n기준: ${payload.asOf}\n\n${payload.summary}`
    );
    expect(response.body.toString()).not.toContain(PAYLOAD.to);
    expect(response.body.toString()).not.toContain(TOKEN);
  });

  it.each(['unlinked', 'linking', 'disconnected', 'logged-out'] as const)(
    'rejects sending in state %s without calling the session',
    async (unconnected) => {
      state = unconnected;
      expect(
        (await call('/notifications', 'POST', AUTHORIZATION, JSON.stringify(PAYLOAD))).status
      ).toBe(503);
      expect(sendText).not.toHaveBeenCalled();
    }
  );

  it.each([
    null,
    [],
    { ...PAYLOAD, to: '15555550123' },
    { ...PAYLOAD, to: '+01234567890' },
    { ...PAYLOAD, to: '+15555550123@s.whatsapp.net' },
    { ...PAYLOAD, to: '+123' },
    { ...PAYLOAD, title: '' },
    { ...PAYLOAD, title: 'x'.repeat(161) },
    { ...PAYLOAD, title: 'unsafe\u0000title' },
    { ...PAYLOAD, asOf: 1 },
    { ...PAYLOAD, asOf: 'x'.repeat(81) },
    { ...PAYLOAD, summary: 'x'.repeat(3001) },
    { ...PAYLOAD, summary: '😀'.repeat(3000) },
    { ...PAYLOAD, extra: 'unexpected' },
  ])('rejects malformed recipient and bounded text case %#', async (payload) => {
    expect(
      (await call('/notifications', 'POST', AUTHORIZATION, JSON.stringify(payload))).status
    ).toBe(400);
    expect(sendText).not.toHaveBeenCalled();
  });

  it('bounds request bodies and rejects invalid JSON or UTF-8 without sending', async () => {
    for (const body of ['{', 'x'.repeat(16_385), Buffer.from([0xff, 0xfe])]) {
      expect((await call('/notifications', 'POST', AUTHORIZATION, body)).status).toBe(400);
    }
    expect(
      (
        await call(
          '/notifications',
          'POST',
          { ...AUTHORIZATION, 'content-type': 'text/plain' },
          JSON.stringify(PAYLOAD)
        )
      ).status
    ).toBe(400);
    expect(sendText).not.toHaveBeenCalled();
  });

  it('bounds a request body that never finishes', async () => {
    const response = await new Promise<number>((resolve, reject) => {
      const client = request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/notifications',
          method: 'POST',
          headers: { ...AUTHORIZATION, 'content-length': '1000' },
          agent: false,
        },
        (result) => {
          result.resume();
          result.once('end', () => resolve(result.statusCode ?? 0));
        }
      );
      client.once('error', reject);
      client.write('{');
    });
    expect(response).toBe(408);
    expect(sendText).not.toHaveBeenCalled();
  });

  it('returns a safe failure without retrying an ambiguous send', async () => {
    sendText.mockImplementation(() => new Promise(() => undefined));
    const response = await call('/notifications', 'POST', AUTHORIZATION, JSON.stringify(PAYLOAD));
    expect(response.status).toBe(504);
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  it('does not return provider exception contents or repeat a failed send', async () => {
    sendText.mockRejectedValue(new Error(`${TOKEN} ${PAYLOAD.to} private provider failure`));
    const response = await call('/notifications', 'POST', AUTHORIZATION, JSON.stringify(PAYLOAD));
    expect(response.status).toBe(502);
    expect(JSON.parse(response.body.toString())).toEqual({ error: 'send-failed' });
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['not-connected', 503],
    ['send-timeout', 504],
    ['send-error', 502],
    ['invalid-recipient', 400],
    ['invalid-text', 400],
  ] as const)('maps safe session failure %s to status %s', async (reason, status) => {
    sendText.mockResolvedValue({ status: 'failed', reason });
    expect(
      (await call('/notifications', 'POST', AUTHORIZATION, JSON.stringify(PAYLOAD))).status
    ).toBe(status);
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  it('does not expose an invalid provider message ID', async () => {
    sendText.mockResolvedValue({ status: 'accepted', messageId: `${TOKEN} ${PAYLOAD.to}` });
    const response = await call('/notifications', 'POST', AUTHORIZATION, JSON.stringify(PAYLOAD));
    expect(response.status).toBe(502);
    expect(JSON.parse(response.body.toString())).toEqual({ error: 'send-failed' });
  });

  it('rejects query parameters, unsupported methods, and unknown routes without side effects', async () => {
    const query = await call(`/status?token=${TOKEN}`);
    expect(query.status).toBe(400);
    expect(query.body.toString()).not.toContain(TOKEN);
    expect((await call('/notifications', 'OPTIONS')).status).toBe(405);
    expect((await call('/unknown')).status).toBe(404);
    expect(sendText).not.toHaveBeenCalled();
  });
});
