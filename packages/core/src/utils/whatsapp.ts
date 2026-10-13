import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readGatewayToken, resolveWhatsAppAuthDir } from '@/whatsapp/config';

export interface WhatsAppNotification {
  title: string;
  asOf: string;
  summary: string;
}

export type WhatsAppNotificationResult =
  | { status: 'disabled'; reason: 'not-configured' | 'invalid-configuration' }
  | { status: 'accepted'; messageId: string }
  | {
      status: 'failed';
      reason:
        | 'http-error'
        | 'invalid-response'
        | 'network-error'
        /** GET /status never answered: no POST was issued (definite non-send). */
        | 'gateway-unreachable'
        /** The gateway answered but the linked session cannot send (definite non-send). */
        | 'session-not-connected';
      httpStatus?: number;
      sessionState?: string;
      /** Number of /status probes made before giving up. */
      probes?: number;
    };

export interface WhatsAppDesktopAlert {
  title: string;
  body: string;
}

interface WhatsAppDependencies {
  environment?: NodeJS.ProcessEnv;
  fetch?: typeof globalThis.fetch;
  readToken?: typeof readGatewayToken;
  /** Test hook: waits between /status probes. */
  sleep?: (milliseconds: number) => Promise<void>;
  /** Test hook: delays between consecutive probes; the first probe is immediate. */
  probeDelaysMs?: readonly number[];
  /** Out-of-band alert; the default posts to macOS Notification Center and never throws. */
  alert?: (alert: WhatsAppDesktopAlert) => Promise<void> | void;
}

interface WhatsAppConfiguration {
  token: string;
  endpoint: string;
  statusEndpoint: string;
  to: string;
}

type GatewayProbe =
  | { outcome: 'connected' }
  | { outcome: 'unreachable' }
  | { outcome: 'not-connected'; state: string }
  /** The gateway answered without a readable state (older build); send as before. */
  | { outcome: 'unknown' };

const REQUEST_TIMEOUT_MS = 10_000;
const PROBE_TIMEOUT_MS = 5_000;
/** Probes at about 0 / 60 / 180 / 600 seconds: definite non-sends are retried for ten minutes. */
const PROBE_DELAYS_MS: readonly number[] = [60_000, 120_000, 420_000];
const runFile = promisify(execFile);

async function configuration(
  environment: NodeJS.ProcessEnv,
  readToken: typeof readGatewayToken
): Promise<WhatsAppConfiguration | Extract<WhatsAppNotificationResult, { status: 'disabled' }>> {
  const recipient = environment.WHATSAPP_TO?.trim() ?? '';
  if (!recipient) {
    // TODO(oma-deferred): configure a recipient and link the local WhatsApp Web session.
    return { status: 'disabled', reason: 'not-configured' };
  }
  if (!/^\+?[1-9]\d{7,14}$/.test(recipient)) {
    return { status: 'disabled', reason: 'invalid-configuration' };
  }
  try {
    const url = new URL(environment.WHATSAPP_GATEWAY_URL?.trim() || 'http://127.0.0.1:5102');
    if (
      url.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    ) {
      return { status: 'disabled', reason: 'invalid-configuration' };
    }
    const token = await readToken(
      resolveWhatsAppAuthDir(environment),
      environment.WHATSAPP_GATEWAY_TOKEN ?? ''
    );
    if (!token) return { status: 'disabled', reason: 'not-configured' };
    if (token.length < 32 || token.length > 512 || !/^[\x21-\x7e]+$/.test(token)) {
      return { status: 'disabled', reason: 'invalid-configuration' };
    }
    return {
      token,
      endpoint: new URL('/notifications', url).href,
      statusEndpoint: new URL('/status', url).href,
      to: `+${recipient.replace(/^\+/, '')}`,
    };
  } catch {
    return { status: 'disabled', reason: 'invalid-configuration' };
  }
}

/** Checks local configuration without contacting the gateway or creating credentials. */
export async function isWhatsAppNotificationConfigured(
  dependencies: Pick<WhatsAppDependencies, 'environment' | 'readToken'> = {}
): Promise<boolean> {
  const configured = await configuration(
    dependencies.environment ?? process.env,
    dependencies.readToken ?? readGatewayToken
  );
  return !('status' in configured);
}

/**
 * Shared notification sanitizer: strips controls, format characters and line
 * separators, collapses whitespace, and bounds the UTF-16 length without
 * splitting surrogate pairs. Multiline mode keeps single blank lines.
 */
export function sanitizeNotificationText(
  value: string,
  maximumLength: number,
  multiline = false
): string {
  const text = value.toWellFormed();
  const normalized = multiline
    ? text
        .replace(/\r\n?/gu, '\n')
        .split('\n')
        .map((line) =>
          line
            .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ')
            .replace(/\s+/gu, ' ')
            .trim()
        )
        .join('\n')
        .replace(/\n{3,}/gu, '\n\n')
        .trim()
    : text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\s]+/gu, ' ').trim();
  let result = '';
  for (const character of normalized) {
    if (result.length + character.length > maximumLength) break;
    result += character;
  }
  return result.trimEnd();
}

function messageId(response: unknown, token: string): string | null {
  if (!response || typeof response !== 'object' || !('messageId' in response)) return null;
  const id: unknown = response.messageId;
  return typeof id === 'string' &&
    /^[A-Fa-f0-9]{16,64}$/.test(id) &&
    id.toLowerCase() !== token.toLowerCase()
    ? id
    : null;
}

/**
 * Best-effort macOS Notification Center alert. Arguments travel through argv so
 * no text is interpolated into AppleScript. Disabled off macOS, under
 * STOCK_CHECKER_DESKTOP_ALERTS=0, and never throws.
 */
export async function sendDesktopAlert(
  alert: WhatsAppDesktopAlert,
  environment: NodeJS.ProcessEnv = process.env
): Promise<void> {
  if (process.platform !== 'darwin' || environment.STOCK_CHECKER_DESKTOP_ALERTS === '0') return;
  try {
    await runFile(
      'osascript',
      [
        '-e',
        'on run argv',
        '-e',
        'display notification (item 2 of argv) with title (item 1 of argv)',
        '-e',
        'end run',
        sanitizeNotificationText(alert.title, 80) || 'Stock Checker',
        sanitizeNotificationText(alert.body, 200) || 'WhatsApp 알림 상태를 확인하세요.',
      ],
      { timeout: 5_000, maxBuffer: 16_384 }
    );
  } catch {
    // Desktop alerts are advisory; a missing osascript must not affect the send result.
  }
}

async function probeGateway(
  fetch: typeof globalThis.fetch,
  statusEndpoint: string
): Promise<GatewayProbe> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  timer.unref?.();
  try {
    const response = await fetch(statusEndpoint, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'error',
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      return { outcome: 'unknown' };
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      return { outcome: 'unknown' };
    }
    const state =
      data && typeof data === 'object' && 'state' in data
        ? (data as { state: unknown }).state
        : null;
    if (typeof state !== 'string' || !/^[a-z-]{1,32}$/.test(state)) return { outcome: 'unknown' };
    return state === 'connected' ? { outcome: 'connected' } : { outcome: 'not-connected', state };
  } catch {
    return { outcome: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

function failureAlert(result: Extract<WhatsAppNotificationResult, { status: 'failed' }>): string {
  switch (result.reason) {
    case 'gateway-unreachable':
      return `WhatsApp 게이트웨이에 연결할 수 없어 알림을 보내지 못했습니다 (probe ${result.probes ?? 1}회). mise run whatsapp:service:status 로 확인하세요.`;
    case 'session-not-connected':
      return `WhatsApp 세션 상태가 '${result.sessionState ?? 'unknown'}'이라 알림을 보내지 못했습니다. QR 재연결 또는 서비스 재시작이 필요할 수 있습니다.`;
    case 'http-error':
      return `WhatsApp 게이트웨이가 알림을 거부했습니다 (HTTP ${result.httpStatus ?? '?'}).`;
    default:
      return 'WhatsApp 알림 전송 결과를 확인할 수 없습니다. 중복 방지를 위해 재시도하지 않았습니다.';
  }
}

/**
 * An accepted result acknowledges the linked session's send; it does not confirm delivery.
 *
 * The send path probes GET /status first. While the gateway is unreachable or the
 * session is not connected, no POST has been issued, so the probe is repeated at
 * about 0/60/180/600 s before giving up. Once a POST is sent, ambiguous outcomes
 * (timeouts, 502/504) are never retried so a message cannot be duplicated.
 */
export async function sendWhatsAppNotification(
  notification: WhatsAppNotification,
  dependencies: WhatsAppDependencies = {}
): Promise<WhatsAppNotificationResult> {
  const environment = dependencies.environment ?? process.env;
  const configured = await configuration(environment, dependencies.readToken ?? readGatewayToken);
  if ('status' in configured) return configured;
  const fetch = dependencies.fetch ?? globalThis.fetch;
  const alert = async (body: string) => {
    try {
      await (dependencies.alert ?? ((item) => sendDesktopAlert(item, environment)))({
        title: 'Stock Checker · WhatsApp 알림 실패',
        body,
      });
    } catch {
      // Alerts never change the send result.
    }
  };

  const sleep =
    dependencies.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, milliseconds);
        timer.unref?.();
      }));
  const delays = dependencies.probeDelaysMs ?? PROBE_DELAYS_MS;
  let probe = await probeGateway(fetch, configured.statusEndpoint);
  let probes = 1;
  for (const delay of delays) {
    if (probe.outcome === 'connected' || probe.outcome === 'unknown') break;
    await sleep(delay);
    probe = await probeGateway(fetch, configured.statusEndpoint);
    probes += 1;
  }
  if (probe.outcome === 'unreachable' || probe.outcome === 'not-connected') {
    const result: WhatsAppNotificationResult =
      probe.outcome === 'unreachable'
        ? { status: 'failed', reason: 'gateway-unreachable', probes }
        : { status: 'failed', reason: 'session-not-connected', sessionState: probe.state, probes };
    await alert(failureAlert(result));
    return result;
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let result: WhatsAppNotificationResult;
  try {
    const body = JSON.stringify({
      to: configured.to,
      title: sanitizeNotificationText(notification.title, 80) || 'N/A',
      asOf: sanitizeNotificationText(notification.asOf, 60) || 'N/A',
      summary: sanitizeNotificationText(notification.summary, 3_000, true) || 'N/A',
    });
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('WhatsApp request timed out'));
      }, REQUEST_TIMEOUT_MS);
      timer.unref?.();
    });
    const request = async (): Promise<WhatsAppNotificationResult> => {
      const response = await fetch(configured.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${configured.token}`,
          'Content-Type': 'application/json',
        },
        body,
        signal: controller.signal,
        redirect: 'error',
      });
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        return { status: 'failed', reason: 'http-error', httpStatus: response.status };
      }
      let data: unknown;
      try {
        data = await response.json();
      } catch {
        return { status: 'failed', reason: 'invalid-response' };
      }
      const id = messageId(data, configured.token);
      return id
        ? { status: 'accepted', messageId: id }
        : { status: 'failed', reason: 'invalid-response' };
    };
    result = await Promise.race([request(), timeout]);
  } catch {
    result = { status: 'failed', reason: 'network-error' };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  if (result.status === 'failed') await alert(failureAlert(result));
  return result;
}
