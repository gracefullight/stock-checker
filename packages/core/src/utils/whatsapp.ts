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
}

interface WhatsAppConfiguration {
  accessToken: string;
  phoneNumberId: string;
  to: string;
  templateName: string;
  language: string;
  version: string;
}

const ENVIRONMENT_KEYS = [
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_TO',
  'WHATSAPP_TEMPLATE_NAME',
  'WHATSAPP_GRAPH_API_VERSION',
] as const;
const REQUEST_TIMEOUT_MS = 10_000;

function configuration(
  environment: NodeJS.ProcessEnv
): WhatsAppConfiguration | Extract<WhatsAppNotificationResult, { status: 'disabled' }> {
  if (ENVIRONMENT_KEYS.every((key) => !environment[key])) {
    // TODO(oma-deferred): provision Meta credentials to enable this deployment.
    return { status: 'disabled', reason: 'not-configured' };
  }
  const accessToken = environment.WHATSAPP_ACCESS_TOKEN?.trim() ?? '';
  const phoneNumberId = environment.WHATSAPP_PHONE_NUMBER_ID?.trim() ?? '';
  const recipient = environment.WHATSAPP_TO?.trim() ?? '';
  const templateName = environment.WHATSAPP_TEMPLATE_NAME?.trim() ?? '';
  const language = environment.WHATSAPP_TEMPLATE_LANGUAGE?.trim() || 'en_US';
  const version = environment.WHATSAPP_GRAPH_API_VERSION?.trim() ?? '';
  if (
    !/^[\x21-\x7e]+$/.test(accessToken) ||
    !/^\d+$/.test(phoneNumberId) ||
    !/^\+?[1-9]\d{1,14}$/.test(recipient) ||
    !/^[a-z0-9_]{1,512}$/.test(templateName) ||
    !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(language) ||
    !/^v[1-9]\d*\.(?:0|[1-9]\d*)$/.test(version)
  ) {
    return { status: 'disabled', reason: 'invalid-configuration' };
  }
  return {
    accessToken,
    phoneNumberId,
    to: recipient.replace(/^\+/, ''),
    templateName,
    language,
    version,
  };
}

function templateText(value: string, maximumLength: number): string {
  const normalized = value
    .toWellFormed()
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  // Bound UTF-16 length without splitting a supplementary Unicode character.
  let result = '';
  for (const character of normalized) {
    if (result.length + character.length > maximumLength) break;
    result += character;
  }
  return result.trimEnd() || 'N/A';
}

function messageId(response: unknown): string | null {
  if (!response || typeof response !== 'object' || !('messages' in response)) return null;
  const messages = response.messages;
  if (!Array.isArray(messages) || messages.length !== 1) return null;
  const id: unknown = messages[0]?.id;
  return typeof id === 'string' && id.length <= 512 && /^wamid\.[A-Za-z0-9+/_-]+={0,2}$/.test(id)
    ? id
    : null;
}

/** An accepted result acknowledges the API request; it does not confirm delivery. */
export async function sendWhatsAppNotification(
  notification: WhatsAppNotification,
  dependencies: WhatsAppDependencies = {}
): Promise<WhatsAppNotificationResult> {
  const configured = configuration(dependencies.environment ?? process.env);
  if ('status' in configured) return configured;

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const body = JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: configured.to,
      type: 'template',
      template: {
        name: configured.templateName,
        language: { code: configured.language },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: templateText(notification.title, 80) },
              { type: 'text', text: templateText(notification.asOf, 60) },
              { type: 'text', text: templateText(notification.summary, 700) },
            ],
          },
        ],
      },
    });
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('WhatsApp request timed out'));
      }, REQUEST_TIMEOUT_MS);
      timer.unref?.();
    });
    const request = async (): Promise<WhatsAppNotificationResult> => {
      const response = await (dependencies.fetch ?? globalThis.fetch)(
        `https://graph.facebook.com/${configured.version}/${configured.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${configured.accessToken}`,
            'Content-Type': 'application/json',
          },
          body,
          signal: controller.signal,
          redirect: 'error',
        }
      );
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
      const id = messageId(data);
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
