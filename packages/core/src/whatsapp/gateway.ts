import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import QRCode from 'qrcode';
import type { WhatsAppSession, WhatsAppSessionState } from './session.ts';

const MAX_BODY_BYTES = 16_384;
const BODY_TIMEOUT_MS = 5000;
const SEND_TIMEOUT_MS = 30_000;
const SECURITY_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  'Content-Security-Policy':
    "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
} as const;

export interface WhatsAppGatewayOptions {
  session: Pick<WhatsAppSession, 'state' | 'sendText'>;
  token: string;
  getQr: () => string | null;
  port?: number;
  bodyTimeoutMs?: number;
  sendTimeoutMs?: number;
}

interface Notification {
  to: string;
  title: string;
  asOf: string;
  summary: string;
}

class InvalidRequest extends Error {
  statusCode: number;

  constructor(statusCode: number) {
    super('Invalid request');
    this.statusCode = statusCode;
  }
}

function safeState(state: WhatsAppSessionState): WhatsAppSessionState {
  switch (state) {
    case 'unlinked':
    case 'linking':
    case 'connected':
    case 'disconnected':
    case 'logged-out':
      return state;
    default:
      return 'disconnected';
  }
}

function json(response: ServerResponse, statusCode: number, payload: object): void {
  if (statusCode >= 400) response.setHeader('Connection', 'close');
  response.writeHead(statusCode, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload));
}

export function isAllowedGatewayRequest(
  request: Pick<IncomingMessage, 'headers'>,
  port: number
): boolean {
  const host = request.headers.host?.toLowerCase();
  const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (port === 80) allowedHosts.push('127.0.0.1', 'localhost');
  if (!host || !allowedHosts.includes(host)) return false;
  const origin = request.headers.origin;
  if (origin !== undefined && origin !== new URL(`http://${host}`).origin) return false;
  const fetchSite = request.headers['sec-fetch-site'];
  return fetchSite === undefined || fetchSite === 'same-origin' || fetchSite === 'none';
}

function isAuthenticated(request: IncomingMessage, expectedHash: Buffer): boolean {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) return false;
  const supplied = authorization.slice(7);
  if (supplied.length < 32 || supplied.length > 512) return false;
  return timingSafeEqual(createHash('sha256').update(supplied).digest(), expectedHash);
}

function hasUnsafeControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return (
      (code < 32 && character !== '\n' && character !== '\r' && character !== '\t') ||
      (code >= 127 && code <= 159)
    );
  });
}

function safeText(value: unknown, limit: number, singleLine: boolean): string {
  if (typeof value !== 'string' || hasUnsafeControl(value)) throw new InvalidRequest(400);
  const text = singleLine ? value.trim().replace(/\s+/g, ' ') : value.trim();
  if (!text || Array.from(text).length > limit) throw new InvalidRequest(400);
  return text;
}

function notification(value: unknown): Notification {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidRequest(400);
  }
  const fields = value as Record<string, unknown>;
  if (
    Object.keys(fields).length !== 4 ||
    typeof fields.to !== 'string' ||
    !/^\+[1-9]\d{7,14}$/.test(fields.to)
  ) {
    throw new InvalidRequest(400);
  }
  return {
    to: fields.to,
    title: safeText(fields.title, 160, true),
    asOf: safeText(fields.asOf, 80, true),
    summary: safeText(fields.summary, 3000, false),
  };
}

function readJson(request: IncomingMessage, timeoutMs: number): Promise<unknown> {
  if (
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '')
  ) {
    return Promise.reject(new InvalidRequest(400));
  }
  const contentLength = request.headers['content-length'];
  if (contentLength !== undefined && Number(contentLength) > MAX_BODY_BYTES) {
    return Promise.reject(new InvalidRequest(400));
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;
    const finish = (error?: InvalidRequest, result?: unknown): void => {
      clearTimeout(timer);
      request.removeListener('data', onData);
      request.removeListener('end', onEnd);
      request.removeListener('aborted', onAborted);
      request.removeListener('error', onAborted);
      if (error) reject(error);
      else resolve(result);
    };
    const onData = (chunk: Buffer): void => {
      length += chunk.length;
      if (length > MAX_BODY_BYTES) {
        finish(new InvalidRequest(400));
        request.resume();
      } else chunks.push(chunk);
    };
    const onEnd = (): void => {
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
        finish(undefined, JSON.parse(text));
      } catch {
        finish(new InvalidRequest(400));
      }
    };
    const onAborted = (): void => finish(new InvalidRequest(400));
    const timer = setTimeout(() => {
      finish(new InvalidRequest(408));
      request.resume();
    }, timeoutMs);
    timer.unref();
    request.on('data', onData);
    request.once('end', onEnd);
    request.once('aborted', onAborted);
    request.once('error', onAborted);
  });
}

function connectionPage(state: WhatsAppSessionState, qrAvailable: boolean): string {
  const descriptions: Record<WhatsAppSessionState, string> = {
    unlinked:
      '연결되지 않았습니다. 게이트웨이를 종료한 뒤 mise run whatsapp:link로 QR 연결을 시작하세요.',
    linking: '연결 중입니다. 휴대폰 WhatsApp에서 연결된 기기 → 기기 연결을 선택하세요.',
    connected:
      'WhatsApp 연결이 완료됐습니다. 이 페이지는 닫아도 됩니다. 알림을 받으려면 게이트웨이는 계속 실행하세요.',
    disconnected: '연결이 끊겼습니다. 게이트웨이와 네트워크 상태를 확인하세요.',
    'logged-out':
      'WhatsApp에서 로그아웃됐습니다. 게이트웨이를 종료하고 새 비공개 WHATSAPP_AUTH_DIR 경로로 mise run whatsapp:link를 실행하세요. API와 MCP에도 같은 새 경로를 설정하세요.',
  };
  const qr = qrAvailable
    ? '<img src="/qr" width="320" height="320" alt="WhatsApp 연결 QR 코드">'
    : '<p>QR 코드가 준비되면 자동으로 표시됩니다.</p>';
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="5"><title>Stock Checker WhatsApp 연결</title><style>body{font-family:system-ui,sans-serif;max-width:560px;margin:48px auto;padding:0 24px;line-height:1.6}img{display:block;max-width:100%;height:auto}h1{font-size:24px}</style></head><body><h1>Stock Checker WhatsApp 연결</h1><p>${descriptions[state]}</p>${state === 'connected' ? '' : qr}<p>이 화면은 5초마다 연결 상태를 갱신합니다.</p></body></html>`;
}

export function createWhatsAppGateway(options: WhatsAppGatewayOptions) {
  if (!/^[\x21-\x7e]{32,512}$/.test(options.token)) throw new Error('Invalid gateway token');
  const expectedHash = createHash('sha256').update(options.token).digest();
  let boundPort = options.port ?? 5102;

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (!isAllowedGatewayRequest(request, boundPort)) {
      request.resume();
      json(response, 403, { error: 'local-access-only' });
      return;
    }
    if (request.url?.includes('?') || request.url?.includes('#')) {
      request.resume();
      json(response, 400, { error: 'invalid-request' });
      return;
    }
    if (request.method === 'GET') {
      const state = safeState(options.session.state);
      if (request.url === '/status') {
        json(response, 200, { state });
      } else if (request.url === '/') {
        response.writeHead(200, {
          ...SECURITY_HEADERS,
          'Content-Type': 'text/html; charset=utf-8',
        });
        response.end(connectionPage(state, state === 'linking' && Boolean(options.getQr())));
      } else if (request.url === '/qr') {
        const qr = options.getQr();
        if (state !== 'linking' || !qr || qr.length > 4096) {
          json(response, 503, { error: 'qr-unavailable' });
          return;
        }
        try {
          const image = await QRCode.toBuffer(qr, {
            type: 'png',
            errorCorrectionLevel: 'M',
            margin: 2,
            width: 320,
          });
          response.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'image/png' });
          response.end(image);
        } catch {
          json(response, 503, { error: 'qr-unavailable' });
        }
      } else {
        json(response, 404, { error: 'not-found' });
      }
      return;
    }
    if (request.method !== 'POST' || request.url !== '/notifications') {
      request.resume();
      json(response, 405, { error: 'method-not-allowed' });
      return;
    }
    if (!isAuthenticated(request, expectedHash)) {
      request.resume();
      json(response, 401, { error: 'unauthorized' });
      return;
    }

    const payload = notification(await readJson(request, options.bodyTimeoutMs ?? BODY_TIMEOUT_MS));
    if (safeState(options.session.state) !== 'connected') {
      json(response, 503, { error: 'not-connected' });
      return;
    }
    const message = `${payload.title}\nAs of: ${payload.asOf}\nResults: ${payload.summary}\nSignal scores are not win probabilities.`;
    if (message.length > 4096) throw new InvalidRequest(400);
    let timeout: NodeJS.Timeout | undefined;
    try {
      const result = await Promise.race([
        options.session.sendText(payload.to, message),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new InvalidRequest(504)),
            options.sendTimeoutMs ?? SEND_TIMEOUT_MS
          );
          timeout.unref();
        }),
      ]);
      if (result.status === 'accepted') {
        if (
          !/^[a-f\d]{16,64}$/i.test(result.messageId) ||
          result.messageId.toLowerCase().includes(options.token.toLowerCase()) ||
          result.messageId.includes(payload.to.slice(1))
        ) {
          json(response, 502, { error: 'send-failed' });
          return;
        }
        json(response, 200, { messageId: result.messageId });
      } else {
        const statusCode =
          result.reason === 'not-connected'
            ? 503
            : result.reason === 'send-timeout'
              ? 504
              : result.reason === 'invalid-recipient' || result.reason === 'invalid-text'
                ? 400
                : 502;
        json(response, statusCode, {
          error: statusCode === 503 ? 'not-connected' : 'send-failed',
        });
      }
    } finally {
      clearTimeout(timeout);
    }
  };

  const server = createServer(
    { maxHeaderSize: 8192, requestTimeout: 10_000, headersTimeout: 5000, keepAliveTimeout: 1000 },
    (request, response) => {
      void handle(request, response).catch((error: unknown) => {
        request.resume();
        if (response.destroyed || response.writableEnded) return;
        if (response.headersSent) {
          response.destroy();
          return;
        }
        json(response, error instanceof InvalidRequest ? error.statusCode : 502, {
          error: error instanceof InvalidRequest ? 'invalid-request' : 'send-failed',
        });
      });
    }
  );
  server.maxConnections = 32;
  server.maxRequestsPerSocket = 50;

  return {
    server,
    async start(): Promise<{ port: number; url: string }> {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(boundPort, '127.0.0.1', () => {
          server.removeListener('error', reject);
          resolve();
        });
      });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Gateway did not start');
      boundPort = address.port;
      return { port: boundPort, url: `http://127.0.0.1:${boundPort}` };
    },
    async stop(): Promise<void> {
      if (!server.listening) return;
      await new Promise<void>((resolve) => {
        const deadline = setTimeout(() => server.closeAllConnections(), 5000);
        deadline.unref();
        server.close(() => {
          clearTimeout(deadline);
          resolve();
        });
        server.closeIdleConnections();
      });
    },
  };
}
