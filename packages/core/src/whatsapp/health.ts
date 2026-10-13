import type { WhatsAppSessionState } from './session.ts';

export interface ManagedSessionWatchdogOptions {
  enabled: boolean;
  pairing: boolean;
  timeoutMs?: number;
  onTimeout: () => void | Promise<void>;
}

export interface ManagedSessionWatchdog {
  onState(state: WhatsAppSessionState): void;
  stop(): void;
}

export interface SessionStateDescription {
  /** True only while notifications can be sent. */
  sendable: boolean;
  /** True when automatic reconnects cannot recover and the user must relink or restart. */
  needsUserAction: boolean;
  guidance: string;
}

/** Shared wording for /status and service status output; never includes credentials. */
export function describeSessionState(state: WhatsAppSessionState): SessionStateDescription {
  switch (state) {
    case 'connected':
      return { sendable: true, needsUserAction: false, guidance: '연결됨 · 알림 전송 가능' };
    case 'linking':
      return { sendable: false, needsUserAction: false, guidance: '연결 중 · 잠시 후 다시 확인' };
    case 'disconnected':
      return {
        sendable: false,
        needsUserAction: false,
        guidance: '연결 끊김 · 자동 재연결 중, 지속되면 mise run whatsapp:service:restart',
      };
    case 'pairing-expired':
      return {
        sendable: false,
        needsUserAction: true,
        guidance: 'QR 만료 · mise run whatsapp:service:restart 후 다시 스캔',
      };
    case 'logged-out':
      return {
        sendable: false,
        needsUserAction: true,
        guidance: '로그아웃됨 · 새 WHATSAPP_AUTH_DIR로 mise run whatsapp:link 재연결 필요',
      };
    default:
      return {
        sendable: false,
        needsUserAction: true,
        guidance: '미연결 · mise run whatsapp:service:install -- --link 로 QR 연결',
      };
  }
}

/** Retire an unrecovered managed process; launchd owns the next startup. */
export function createManagedSessionWatchdog(
  options: ManagedSessionWatchdogOptions
): ManagedSessionWatchdog {
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
    throw new RangeError('Invalid WhatsApp managed connection timeout.');
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let connectedBefore = false;
  let needsUserAction = false;
  let stopped = false;
  let expired = false;

  function cancelTimer(): void {
    if (timer) clearTimeout(timer);
    timer = undefined;
  }

  return {
    onState(state) {
      if (!options.enabled || stopped || expired) return;
      if (state === 'connected') {
        connectedBefore = true;
        needsUserAction = false;
        cancelTimer();
        return;
      }
      if (state === 'unlinked' || state === 'logged-out' || state === 'pairing-expired') {
        needsUserAction = true;
        cancelTimer();
        return;
      }
      if (
        state !== 'disconnected' ||
        needsUserAction ||
        timer ||
        (options.pairing && !connectedBefore)
      )
        return;
      // Linking during reconnects keeps the original outage deadline.
      timer = setTimeout(() => {
        timer = undefined;
        if (stopped || expired) return;
        expired = true;
        try {
          void Promise.resolve(options.onTimeout()).catch(() => {});
        } catch {
          // Lifecycle callbacks must not expose private provider errors.
        }
      }, timeoutMs);
      timer.unref?.();
    },
    stop() {
      stopped = true;
      cancelTimer();
    },
  };
}
