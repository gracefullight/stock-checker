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
      reason: 'http-error' | 'invalid-response' | 'network-error';
      httpStatus?: number;
    };

interface WhatsAppDependencies {
  environment?: NodeJS.ProcessEnv;
  fetch?: typeof globalThis.fetch;
  readToken?: typeof readGatewayToken;
}

interface WhatsAppConfiguration {
  token: string;
  endpoint: string;
  to: string;
}

const REQUEST_TIMEOUT_MS = 10_000;

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
      to: `+${recipient.replace(/^\+/, '')}`,
    };
  } catch {
    return { status: 'disabled', reason: 'invalid-configuration' };
  }
}

function notificationText(value: string, maximumLength: number): string {
  const normalized = value
    .toWellFormed()
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  let result = '';
  for (const character of normalized) {
    if (result.length + character.length > maximumLength) break;
    result += character;
  }
  return result.trimEnd() || 'N/A';
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

/** An accepted result acknowledges the linked session's send; it does not confirm delivery. */
export async function sendWhatsAppNotification(
  notification: WhatsAppNotification,
  dependencies: WhatsAppDependencies = {}
): Promise<WhatsAppNotificationResult> {
  const configured = await configuration(
    dependencies.environment ?? process.env,
    dependencies.readToken ?? readGatewayToken
  );
  if ('status' in configured) return configured;

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const body = JSON.stringify({
      to: configured.to,
      title: notificationText(notification.title, 80),
      asOf: notificationText(notification.asOf, 60),
      summary: notificationText(notification.summary, 700),
    });
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('WhatsApp request timed out'));
      }, REQUEST_TIMEOUT_MS);
      timer.unref?.();
    });
    const request = async (): Promise<WhatsAppNotificationResult> => {
      const response = await (dependencies.fetch ?? globalThis.fetch)(configured.endpoint, {
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
    return await Promise.race([request(), timeout]);
  } catch {
    return { status: 'failed', reason: 'network-error' };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
