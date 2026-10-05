import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pino from 'pino';
import { ensureGatewayToken, getWhatsAppGatewayConfiguration } from './config.ts';
import { createWhatsAppGateway } from './gateway.ts';
import { createManagedSessionWatchdog, type ManagedSessionWatchdog } from './health.ts';
import { createWhatsAppSession } from './session.ts';

const logger = pino({ name: 'whatsapp-gateway' }, process.stderr);

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
  const session = createWhatsAppSession({
    authDirectory: configuration.authDirectory,
    allowPairing: arguments_.includes('--link'),
    onQr(qr) {
      currentQr = qr;
    },
    onState(state) {
      logger.info({ state }, 'WhatsApp 연결 상태');
      watchdog?.onState(state);
    },
    onDiagnostic(diagnostic) {
      logger.info(diagnostic, 'WhatsApp 연결 진단');
    },
  });
  const gateway = createWhatsAppGateway({
    session,
    token,
    getQr: () => currentQr,
    port: configuration.port,
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
