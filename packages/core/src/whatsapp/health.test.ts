import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createManagedSessionWatchdog } from './health.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('managed WhatsApp connection watchdog', () => {
  it('does not retire an ordinary gateway even after it loses an established connection', async () => {
    const onTimeout = vi.fn();
    const watchdog = createManagedSessionWatchdog({ enabled: false, pairing: false, onTimeout });
    watchdog.onState('disconnected');
    watchdog.onState('connected');
    watchdog.onState('disconnected');
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses a five-minute grace period for a managed registered session that fails initial connection', async () => {
    const onTimeout = vi.fn();
    const watchdog = createManagedSessionWatchdog({ enabled: true, pairing: false, onTimeout });
    watchdog.onState('linking');
    expect(vi.getTimerCount()).toBe(0);
    watchdog.onState('disconnected');
    await vi.advanceTimersByTimeAsync(299999);
    expect(onTimeout).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not extend an outage deadline during repeated reconnect attempts', async () => {
    const onTimeout = vi.fn();
    const watchdog = createManagedSessionWatchdog({
      enabled: true,
      pairing: false,
      timeoutMs: 100,
      onTimeout,
    });
    watchdog.onState('connected');
    watchdog.onState('disconnected');
    await vi.advanceTimersByTimeAsync(30);
    watchdog.onState('linking');
    await vi.advanceTimersByTimeAsync(30);
    watchdog.onState('disconnected');
    await vi.advanceTimersByTimeAsync(30);
    watchdog.onState('linking');
    await vi.advanceTimersByTimeAsync(10);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    watchdog.onState('disconnected');
    await vi.advanceTimersByTimeAsync(1000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels a recovered outage and grants a fresh grace period after the next disconnection', async () => {
    const onTimeout = vi.fn();
    const watchdog = createManagedSessionWatchdog({
      enabled: true,
      pairing: false,
      timeoutMs: 100,
      onTimeout,
    });
    watchdog.onState('disconnected');
    await vi.advanceTimersByTimeAsync(90);
    watchdog.onState('connected');
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onTimeout).not.toHaveBeenCalled();
    watchdog.onState('disconnected');
    await vi.advanceTimersByTimeAsync(99);
    expect(onTimeout).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it.each(['unlinked', 'logged-out'] as const)(
    'cancels automatic retirement when %s requires user action',
    async (state) => {
      const onTimeout = vi.fn();
      const watchdog = createManagedSessionWatchdog({
        enabled: true,
        pairing: false,
        timeoutMs: 100,
        onTimeout,
      });
      watchdog.onState('connected');
      watchdog.onState('disconnected');
      await vi.advanceTimersByTimeAsync(50);
      watchdog.onState(state);
      expect(vi.getTimerCount()).toBe(0);
      watchdog.onState('linking');
      watchdog.onState('disconnected');
      await vi.advanceTimersByTimeAsync(1000);
      expect(onTimeout).not.toHaveBeenCalled();
    }
  );

  it('leaves initial managed QR pairing failures pending without process restart loops', async () => {
    const onTimeout = vi.fn();
    const watchdog = createManagedSessionWatchdog({
      enabled: true,
      pairing: true,
      timeoutMs: 100,
      onTimeout,
    });
    watchdog.onState('linking');
    watchdog.onState('disconnected');
    watchdog.onState('linking');
    watchdog.onState('disconnected');
    await vi.advanceTimersByTimeAsync(1000);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    watchdog.onState('connected');
    watchdog.onState('disconnected');
    await vi.advanceTimersByTimeAsync(100);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('cancels the timer on shutdown and ignores every subsequent state callback', async () => {
    const onTimeout = vi.fn();
    const watchdog = createManagedSessionWatchdog({
      enabled: true,
      pairing: false,
      timeoutMs: 100,
      onTimeout,
    });
    watchdog.onState('disconnected');
    watchdog.stop();
    watchdog.stop();
    expect(vi.getTimerCount()).toBe(0);
    watchdog.onState('connected');
    watchdog.onState('disconnected');
    await vi.advanceTimersByTimeAsync(1000);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it.each(['throw', 'reject'] as const)(
    'isolates a %s from retirement callback and never retries it',
    async (failure) => {
      const onTimeout = vi.fn(() => {
        if (failure === 'throw') throw new Error('private-provider-error');
        return Promise.reject(new Error('private-provider-error'));
      });
      const watchdog = createManagedSessionWatchdog({
        enabled: true,
        pairing: false,
        timeoutMs: 100,
        onTimeout,
      });
      watchdog.onState('disconnected');
      await vi.advanceTimersByTimeAsync(1000);
      expect(onTimeout).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    }
  );
});
