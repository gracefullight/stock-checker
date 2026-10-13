import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pino from 'pino';
import { ensureGatewayToken, getWhatsAppGatewayConfiguration } from './config.ts';
import { createWhatsAppGateway, DEFAULT_DAILY_SEND_CAP } from './gateway.ts';
import {
  createManagedSessionWatchdog,
  describeSessionState,
  type ManagedSessionWatchdog,
} from './health.ts';
import { createWhatsAppSession } from './session.ts';

const logger = pino({ name: 'whatsapp-gateway' }, process.stderr);

/** The gateway only sends to the configured recipient; an unset WHATSAPP_TO pins nothing. */
export function allowedRecipientsFromEnvironment(
  environment: NodeJS.ProcessEnv
): string[] | undefined {
  const recipient = environment.WHATSAPP_TO?.trim();
  if (!recipient || !/^\+?[1-9]\d{7,14}$/.test(recipient)) return undefined;
  return [`+${recipient.replace(/^\+/, '')}`];
}

export function dailySendCapFromEnvironment(environment: NodeJS.ProcessEnv): number {
  const raw = environment.WHATSAPP_DAILY_SEND_CAP?.trim();
  if (!raw) return DEFAULT_DAILY_SEND_CAP;
  if (!/^\d{1,5}$/.test(raw) || Number(raw) < 1 || Number(raw) > 10_000) {
    throw new Error('Invalid WHATSAPP_DAILY_SEND_CAP');
  }
  return Number(raw);
}

export async function runWhatsAppGateway(
  arguments_: string[] = process.argv.slice(2),
  environment: NodeJS.ProcessEnv = process.env
): Promise<void> {
  if (arguments_.some((argument) => argument !== '--link')) {
    throw new Error('Use --link to enable WhatsApp QR pairing');
  }
  const configuration = getWhatsAppGatewayConfiguration(environment);
  const token = await ensureGatewayToken(
    configuration.authDirectory,
    environment.WHATSAPP_GATEWAY_TOKEN
  );
  let currentQr: string | null = null;
  let watchdog: ManagedSessionWatchdog | undefined;
  let gateway: ReturnType<typeof createWhatsAppGateway> | undefined;
  const session = createWhatsAppSession({
    authDirectory: configuration.authDirectory,
    allowPairing: arguments_.includes('--link'),
    onQr(qr) {
      currentQr = qr;
    },
    onState(state) {
      logger.info({ state, ...describeSessionState(state) }, 'WhatsApp 연결 상태');
      gateway?.observeState(state);
      watchdog?.onState(state);
    },
    onDiagnostic(diagnostic) {
      logger.info(diagnostic, 'WhatsApp 연결 진단');
    },
  });
  gateway = createWhatsAppGateway({
    session,
    token,
    getQr: () => currentQr,
    port: configuration.port,
    allowedRecipients: allowedRecipientsFromEnvironment(environment),
    dailySendCap: dailySendCapFromEnvironment(environment),
  });
  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    stopping ??= (async () => {
      watchdog?.stop();
      currentQr = null;
      await Promise.allSettled([gateway.stop(), session.stop()]);
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
    })();
    return stopping;
  };
  const onSignal = (): void => {
    void stop();
  };
  watchdog = createManagedSessionWatchdog({
    enabled: environment.WHATSAPP_MANAGED_SERVICE === '1',
    pairing: arguments_.includes('--link'),
    async onTimeout() {
      logger.warn('WhatsApp 연결이 복구되지 않아 관리 서비스를 다시 시작합니다.');
      await stop();
      process.exitCode = 1;
    },
  });
  try {
    const address = await gateway.start();
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    logger.info({ url: address.url }, 'WhatsApp 연결 화면');
    await session.start();
  } catch {
    await stop();
    throw new Error('WhatsApp gateway startup failed');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void runWhatsAppGateway().catch(() => {
    logger.error('WhatsApp 게이트웨이를 시작하지 못했습니다. 로컬 설정을 확인하세요.');
    process.exitCode = 1;
  });
}
