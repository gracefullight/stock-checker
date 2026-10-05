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
