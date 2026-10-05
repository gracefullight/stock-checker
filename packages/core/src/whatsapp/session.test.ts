import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BufferJSON, DisconnectReason, initAuthCreds, proto } from '@whiskeysockets/baileys';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createWhatsAppSession,
  type WhatsAppSession,
  type WhatsAppSessionDependencies,
  type WhatsAppSessionOptions,
} from './session.ts';

type SocketFactory = NonNullable<WhatsAppSessionDependencies['makeSocket']>;
type Socket = ReturnType<SocketFactory>;

function acknowledgment(id = 'SC_ACK_1'): NonNullable<Awaited<ReturnType<Socket['sendMessage']>>> {
  return { key: { id } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

let root: string;
let authDirectory: string;
const sessions: WhatsAppSession[] = [];
const children: ChildProcess[] = [];

function harness(
  options: Partial<WhatsAppSessionOptions> = {},
  dependencies: Omit<WhatsAppSessionDependencies, 'makeSocket'> = {}
) {
  const sockets: {
    socket: Socket;
    events: EventEmitter;
    ws: EventEmitter;
    configuration: Parameters<SocketFactory>[0];
    sendMessage: ReturnType<typeof vi.fn<Socket['sendMessage']>>;
    end: ReturnType<typeof vi.fn<Socket['end']>>;
  }[] = [];
  const makeSocket = vi.fn<SocketFactory>((configuration) => {
    const events = new EventEmitter();
    const ws = new EventEmitter();
    const sendMessage = vi.fn<Socket['sendMessage']>().mockResolvedValue(acknowledgment());
    const end = vi.fn<Socket['end']>();
    const socket: Socket = {
      ev: events as unknown as Socket['ev'],
      sendMessage,
      end,
      ws: ws as unknown as NonNullable<Socket['ws']>,
    };
    sockets.push({ socket, events, ws, configuration, sendMessage, end });
    return socket;
  });
  const session = createWhatsAppSession(
    { authDirectory, allowPairing: true, ...options },
    { makeSocket, ...dependencies }
  );
  sessions.push(session);
  return { session, makeSocket, sockets };
}

async function saveRegisteredCredentials(directory = authDirectory) {
  await mkdir(directory, { recursive: true });
  const creds = initAuthCreds();
  creds.registered = true;
  await writeFile(join(directory, 'creds.json'), JSON.stringify(creds, BufferJSON.replacer));
}

async function saveQrPairedCredentials() {
  await mkdir(authDirectory, { recursive: true });
  const creds = initAuthCreds();
  creds.me = { id: '15551234567:3@s.whatsapp.net', name: 'Offline fixture' };
  creds.account = {
    details: Buffer.from([1, 2, 3]),
    accountSignatureKey: Buffer.alloc(32, 1),
    accountSignature: Buffer.alloc(64, 2),
    deviceSignature: Buffer.alloc(64, 3),
  };
  await writeFile(join(authDirectory, 'creds.json'), JSON.stringify(creds, BufferJSON.replacer));
}

function closeWith(events: EventEmitter, code: DisconnectReason) {
  events.emit('connection.update', {
    connection: 'close',
    lastDisconnect: {
      error: Object.assign(new Error('private-provider-error'), { output: { statusCode: code } }),
      date: new Date(),
    },
  });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'stock-checker-whatsapp-session-'));
  authDirectory = join(root, 'auth');
});

afterEach(async () => {
  for (const session of sessions.splice(0)) await session.stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  }
  await rm(root, { recursive: true, force: true });
});

describe('WhatsApp outbound session', () => {
  it('leaves an unregistered session unlinked unless QR pairing was explicitly permitted', async () => {
    const onQr = vi.fn();
    const { session, makeSocket } = harness({ allowPairing: false, onQr });
    await session.start();
    expect(session.state).toBe('unlinked');
    expect(makeSocket).not.toHaveBeenCalled();
    expect(onQr).not.toHaveBeenCalled();
    expect(await readdir(authDirectory)).toEqual([]);
    expect((await lstat(authDirectory)).mode & 0o777).toBe(0o700);
    expect(await session.sendText('+821012345678', 'fixture')).toEqual({
      status: 'failed',
      reason: 'not-connected',
    });
  });

  it('exposes QR only through callbacks and listens only to connection and credential events', async () => {
    const onQr = vi.fn();
    const onState = vi.fn();
    const { session, sockets } = harness({ onQr, onState });
    await session.start();
    const { configuration, events } = sockets[0];
    expect(configuration.logger?.level).toBe('silent');
    expect(configuration).toMatchObject({
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      enableAutoSessionRecreation: false,
      enableRecentMessageCache: false,
      maxMsgRetryCount: 0,
    });
    expect(configuration.shouldSyncHistoryMessage?.({})).toBe(false);
    expect(configuration.shouldIgnoreJid?.('fixture@s.whatsapp.net')).toBe(true);
    expect(await configuration.getMessage?.({})).toBeUndefined();
    expect(events.eventNames().sort()).toEqual(['connection.update', 'creds.update']);
    events.emit('connection.update', { qr: 'fixture-private-qr' });
    expect(session.state).toBe('linking');
    expect(onQr).toHaveBeenCalledWith('fixture-private-qr');
    expect(await readdir(authDirectory)).toEqual(['.session-lock']);
    events.emit('connection.update', { connection: 'open' });
    expect(session.state).toBe('connected');
    expect(onQr).toHaveBeenLastCalledWith(null);
    expect(onState).toHaveBeenLastCalledWith('connected');
  });

  it('reuses registered credentials without permitting a new QR login', async () => {
    await saveRegisteredCredentials();
    const onQr = vi.fn();
    const { session, makeSocket, sockets } = harness({ allowPairing: false, onQr });
    await session.start();
    expect(makeSocket).toHaveBeenCalledTimes(1);
    expect(sockets[0].configuration.auth.creds.registered).toBe(true);
    sockets[0].events.emit('connection.update', { qr: 'unexpected-private-qr' });
    expect(session.state).toBe('unlinked');
    expect(onQr).not.toHaveBeenCalledWith('unexpected-private-qr');
    expect(sockets[0].end).toHaveBeenCalledTimes(1);
    await session.stop();
    expect(await readdir(authDirectory)).toEqual(['creds.json']);
  });

  it('reconnects saved QR-paired identity even when the SDK registered flag remains false', async () => {
    await saveQrPairedCredentials();
    const onQr = vi.fn();
    const { session, sockets, makeSocket } = harness({ allowPairing: false, onQr });
    await session.start();
    expect(makeSocket).toHaveBeenCalledTimes(1);
    expect(session.state).toBe('linking');
    expect(sockets[0].configuration.auth.creds.registered).toBe(false);
    expect(sockets[0].configuration.auth.creds.me?.id).toBe('15551234567:3@s.whatsapp.net');
    expect(onQr).not.toHaveBeenCalled();
    sockets[0].events.emit('connection.update', { connection: 'open' });
    expect(session.state).toBe('connected');
    await session.stop();
    expect(session.state).toBe('disconnected');
    expect(JSON.parse(await readFile(join(authDirectory, 'creds.json'), 'utf8')).registered).toBe(
      false
    );
  });

  it('keeps a pending pairing-code identity unlinked when no verified account was saved', async () => {
    await mkdir(authDirectory);
    const creds = initAuthCreds();
    creds.me = { id: '15551234567@s.whatsapp.net', name: '~' };
    creds.pairingCode = 'OFFLINE_FIXTURE';
    await writeFile(join(authDirectory, 'creds.json'), JSON.stringify(creds, BufferJSON.replacer));
    const onQr = vi.fn();
    const { session, makeSocket } = harness({ allowPairing: false, onQr });
    await session.start();
    expect(session.state).toBe('unlinked');
    expect(makeSocket).not.toHaveBeenCalled();
    expect(onQr).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(join(authDirectory, 'creds.json'), 'utf8')).registered).toBe(
      false
    );
  });

  it('ignores pairing refresh diagnostics for QR-paired credentials with registered false', async () => {
    await saveQrPairedCredentials();
    const onDiagnostic = vi.fn();
    const { session, sockets } = harness({ allowPairing: false, onDiagnostic });
    await session.start();
    sockets[0].ws.emit('CB:notification,type:companion_reg_refresh', {
      content: [{ tag: 'companion_reg_refresh' }],
    });
    expect(onDiagnostic).not.toHaveBeenCalled();
    expect(sockets[0].configuration.auth.creds.registered).toBe(false);
  });

  it('keeps exhausted QR-paired reconnects disconnected rather than expiring a new pairing', async () => {
    await saveQrPairedCredentials();
    const { session, sockets, makeSocket } = harness(
      { allowPairing: true },
      { reconnectDelayMs: 5, maxReconnectAttempts: 1 }
    );
    await session.start();
    sockets[0].events.emit('connection.update', { qr: 'fixture-private-qr' });
    vi.useFakeTimers();
    closeWith(sockets[0].events, DisconnectReason.connectionLost);
    await vi.advanceTimersByTimeAsync(5);
    closeWith(sockets[1].events, DisconnectReason.connectionLost);
    expect(session.state).toBe('disconnected');
    expect(makeSocket).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    null,
    'fixture-private-identity',
    {},
    { id: 123 },
    { id: '' },
    { id: '15551234567:invalid@s.whatsapp.net' },
    { id: '15551234567@lid' },
    { id: '15551234567@s.whatsapp.net\n' },
  ])('rejects malformed saved paired identity without opening a socket: %j', async (me) => {
    await mkdir(authDirectory);
    const creds = { ...initAuthCreds(), me };
    const saved = JSON.stringify(creds, BufferJSON.replacer);
    await writeFile(join(authDirectory, 'creds.json'), saved);
    const { session, makeSocket } = harness({ allowPairing: false });
    await expect(session.start()).rejects.toThrow('WhatsApp session could not be started');
    expect(makeSocket).not.toHaveBeenCalled();
    expect(await readFile(join(authDirectory, 'creds.json'), 'utf8')).toBe(saved);
  });

  it('hides a consumed QR immediately after pairing success before the connection opens', async () => {
    let currentQr: string | null = null;
    const onQr = vi.fn((qr: string | null) => {
      currentQr = qr;
    });
    const onState = vi.fn();
    const { session, sockets, makeSocket } = harness({ onQr, onState });
    await session.start();
    sockets[0].events.emit('connection.update', { qr: 'fixture-private-qr' });
    expect(currentQr).toBe('fixture-private-qr');
    sockets[0].events.emit('connection.update', { isNewLogin: true, qr: undefined });
    expect(onQr).toHaveBeenLastCalledWith(null);
    expect(currentQr).toBeNull();
    expect(session.state).toBe('linking');
    expect(onState).not.toHaveBeenCalledWith('connected');
    expect(makeSocket).toHaveBeenCalledTimes(1);
    expect(await session.sendText('+821012345678', 'fixture')).toEqual({
      status: 'failed',
      reason: 'not-connected',
    });
    sockets[0].events.emit('connection.update', { connection: 'open' });
    expect(session.state).toBe('connected');
  });

  it('keeps the current QR visible when pairing success comes from an old socket', async () => {
    let currentQr: string | null = null;
    const { session, sockets } = harness(
      {
        onQr: (qr) => {
          currentQr = qr;
        },
      },
      { reconnectDelayMs: 5 }
    );
    await session.start();
    sockets[0].events.emit('connection.update', { qr: 'fixture-private-old-qr' });
    vi.useFakeTimers();
    closeWith(sockets[0].events, DisconnectReason.connectionLost);
    await vi.advanceTimersByTimeAsync(5);
    sockets[1].events.emit('connection.update', { qr: 'fixture-private-current-qr' });
    sockets[0].events.emit('connection.update', { isNewLogin: true, qr: undefined });
    expect(currentQr).toBe('fixture-private-current-qr');
    expect(session.state).toBe('linking');
    sockets[1].events.emit('connection.update', { isNewLogin: true, qr: undefined });
    expect(currentQr).toBeNull();
    expect(session.state).toBe('linking');
  });

  it.each(['companion_reg_refresh', 'pair-device-rotate-qr'] as const)(
    'reports only the allowed refresh child validity for %s',
    async (tag) => {
      const onDiagnostic = vi.fn();
      const { session, sockets } = harness({ onDiagnostic });
      await session.start();
      sockets[0].ws.emit('CB:notification,type:companion_reg_refresh', {
        tag: 'notification',
        attrs: {
          from: 'fixture-private-phone',
          id: 'fixture-private-id',
          token: 'fixture-private-key',
        },
        content: [
          {
            tag,
            attrs: { qr: 'fixture-private-qr' },
            content: Buffer.from('fixture-private-auth'),
          },
        ],
      });
      expect(onDiagnostic.mock.calls).toEqual([
        [{ event: 'companion-registration-refresh', validChild: true }],
      ]);
      expect(JSON.stringify(onDiagnostic.mock.calls)).not.toMatch(
        /fixture-private|attrs|content|from|token/
      );
      expect(sockets[0].sendMessage).not.toHaveBeenCalled();
      expect(session.state).toBe('linking');
      expect(await readdir(authDirectory)).toEqual(['.session-lock']);
    }
  );

  it.each([
    undefined,
    null,
    {},
    { content: Buffer.from('fixture-private-key') },
    { content: ['pair-device-rotate-qr'] },
    { content: [{ tag: 'fixture-private-qr' }] },
  ])('reports malformed or unrelated refresh content only as false: %j', async (node) => {
    const onDiagnostic = vi.fn();
    const { session, sockets } = harness({ onDiagnostic });
    await session.start();
    sockets[0].ws.emit('CB:notification,type:companion_reg_refresh', node);
    expect(onDiagnostic.mock.calls).toEqual([
      [{ event: 'companion-registration-refresh', validChild: false }],
    ]);
  });

  it('reports pairing success once and ignores refresh diagnostics after registration', async () => {
    const onDiagnostic = vi.fn();
    const { session, sockets } = harness({ onDiagnostic });
    await session.start();
    sockets[0].events.emit('creds.update', { registered: true });
    sockets[0].ws.emit('CB:notification,type:companion_reg_refresh', {
      content: [{ tag: 'companion_reg_refresh' }],
    });
    sockets[0].ws.emit('CB:iq,,pair-success', { attrs: { phone: 'fixture-private-phone' } });
    sockets[0].ws.emit('CB:iq,,pair-success', { content: Buffer.from('fixture-private-key') });
    expect(onDiagnostic.mock.calls).toEqual([[{ event: 'pairing-success' }]]);
    await sockets[0].configuration.auth.keys.get('session', ['fixture']);
    expect(sockets[0].configuration.auth.creds.registered).toBe(true);
  });

  it('detaches diagnostic listeners from old sockets and stops reporting after shutdown', async () => {
    const onDiagnostic = vi.fn();
    const { session, sockets } = harness({ onDiagnostic }, { reconnectDelayMs: 10 });
    await session.start();
    vi.useFakeTimers();
    closeWith(sockets[0].events, DisconnectReason.connectionLost);
    expect(onDiagnostic).toHaveBeenLastCalledWith({ event: 'disconnect', statusCode: 408 });
    expect(sockets[0].ws.eventNames()).toEqual([]);
    sockets[0].ws.emit('CB:iq,,pair-success');
    await vi.advanceTimersByTimeAsync(10);
    sockets[1].ws.emit('CB:iq,,pair-success');
    expect(onDiagnostic.mock.calls).toEqual([
      [{ event: 'disconnect', statusCode: 408 }],
      [{ event: 'pairing-success' }],
    ]);
    await session.stop();
    expect(sockets[1].ws.eventNames()).toEqual([]);
    sockets[1].ws.emit('CB:notification,type:companion_reg_refresh', {
      content: [{ tag: 'companion_reg_refresh' }],
    });
    sockets[1].ws.emit('CB:iq,,pair-success');
    expect(onDiagnostic).toHaveBeenCalledTimes(2);
  });

  it('isolates diagnostic callback errors from credential persistence and connection state', async () => {
    const onDiagnostic = vi.fn(() => {
      throw new Error('fixture-private-control-error');
    });
    const { session, sockets } = harness({ onDiagnostic }, { maxReconnectAttempts: 0 });
    await session.start();
    expect(() =>
      sockets[0].ws.emit('CB:notification,type:companion_reg_refresh', {
        content: [{ tag: 'companion_reg_refresh' }],
      })
    ).not.toThrow();
    expect(() => sockets[0].ws.emit('CB:iq,,pair-success')).not.toThrow();
    sockets[0].events.emit('creds.update', { registered: true, firstUnuploadedPreKeyId: 9 });
    await sockets[0].configuration.auth.keys.get('session', ['fixture']);
    expect(() => closeWith(sockets[0].events, DisconnectReason.connectionLost)).not.toThrow();
    expect(session.state).toBe('disconnected');
    await session.stop();
    const creds = JSON.parse(
      await readFile(join(authDirectory, 'creds.json'), 'utf8'),
      BufferJSON.reviver
    );
    expect(creds.registered).toBe(true);
    expect(creds.firstUnuploadedPreKeyId).toBe(9);
    expect(onDiagnostic).toHaveBeenCalledTimes(3);
  });

  it.each([undefined, '401', Number.NaN, Number.POSITIVE_INFINITY, -401, 99, 1000, 408.5])(
    'omits invalid disconnect status codes from diagnostics: %s',
    async (statusCode) => {
      const onDiagnostic = vi.fn();
      const { session, sockets } = harness({ onDiagnostic }, { maxReconnectAttempts: 0 });
      await session.start();
      sockets[0].events.emit('connection.update', {
        connection: 'close',
        lastDisconnect: {
          error: Object.assign(new Error('fixture-private-error'), {
            output: { statusCode, message: 'fixture-private-phone' },
          }),
          date: new Date(),
        },
      });
      expect(onDiagnostic.mock.calls).toEqual([[{ event: 'disconnect' }]]);
      expect(session.state).toBe('disconnected');
    }
  );

  it('supports minimal mock sockets without a websocket event emitter', async () => {
    const onDiagnostic = vi.fn();
    const { session, makeSocket } = harness({ onDiagnostic });
    const events = new EventEmitter();
    makeSocket.mockReturnValueOnce({
      ev: events as unknown as Socket['ev'],
      sendMessage: vi.fn<Socket['sendMessage']>().mockResolvedValue(acknowledgment()),
      end: vi.fn<Socket['end']>(),
    });
    await session.start();
    events.emit('connection.update', { connection: 'open' });
    expect(session.state).toBe('connected');
    await session.stop();
    expect(onDiagnostic).not.toHaveBeenCalled();
  });

  it('serializes credential and Signal-key updates into private atomic files and restores them', async () => {
    const { session, sockets } = harness();
    await session.start();
    const { events, configuration } = sockets[0];
    events.emit('creds.update', { registered: true, firstUnuploadedPreKeyId: 1 });
    events.emit('creds.update', { firstUnuploadedPreKeyId: 2 });
    events.emit('creds.update', { firstUnuploadedPreKeyId: 3 });
    const writes = Array.from({ length: 8 }, (_, index) =>
      configuration.auth.keys.set({ session: { 'fixture/key:1': new Uint8Array([index, 9]) } })
    );
    await Promise.all(writes);
    const restored = await configuration.auth.keys.get('session', ['fixture/key:1']);
    expect(Array.from(restored['fixture/key:1'])).toEqual([7, 9]);
    await configuration.auth.keys.set({
      'app-state-sync-key': { fixture: { keyData: new Uint8Array([1, 2]) } },
    });
    const appKey = await configuration.auth.keys.get('app-state-sync-key', ['fixture']);
    expect(appKey.fixture).toBeInstanceOf(proto.Message.AppStateSyncKeyData);
    await session.stop();
    const creds = JSON.parse(
      await readFile(join(authDirectory, 'creds.json'), 'utf8'),
      BufferJSON.reviver
    );
    expect(creds.firstUnuploadedPreKeyId).toBe(3);
    expect(creds.registered).toBe(true);
    const files = await readdir(authDirectory);
    expect(files).not.toContain('.session-lock');
    expect(files.every((name) => !name.startsWith('.auth-'))).toBe(true);
    for (const name of files)
      expect((await lstat(join(authDirectory, name))).mode & 0o777).toBe(0o600);
    const restarted = harness({ allowPairing: false });
    await restarted.session.start();
    expect(restarted.sockets[0].configuration.auth.creds.firstUnuploadedPreKeyId).toBe(3);
  });

  it('removes explicitly deleted Signal keys without storing incoming chats or contacts', async () => {
    const { session, sockets } = harness();
    await session.start();
    const keys = sockets[0].configuration.auth.keys;
    await keys.set({ session: { fixture: new Uint8Array([1]) } });
    await keys.set({ session: { fixture: null } });
    expect(await keys.get('session', ['fixture'])).toEqual({ fixture: null });
    expect(await readdir(authDirectory)).toEqual(['.session-lock']);
  });

  it('restarts after a pairing restartRequired event using the same saved credentials', async () => {
    const { session, makeSocket, sockets } = harness({}, { reconnectDelayMs: 20 });
    await session.start();
    sockets[0].events.emit('creds.update', { registered: true });
    await sockets[0].configuration.auth.keys.get('session', ['fixture']);
    vi.useFakeTimers();
    closeWith(sockets[0].events, DisconnectReason.restartRequired);
    expect(session.state).toBe('disconnected');
    await vi.advanceTimersByTimeAsync(20);
    expect(makeSocket).toHaveBeenCalledTimes(2);
    expect(sockets[1].configuration.auth.creds.registered).toBe(true);
    expect(sockets[0].events.listenerCount('connection.update')).toBe(0);
    sockets[0].events.emit('connection.update', { connection: 'open' });
    expect(session.state).toBe('linking');
    sockets[1].events.emit('connection.update', { connection: 'open' });
    expect(session.state).toBe('connected');
  });

  it.each([
    DisconnectReason.loggedOut,
    DisconnectReason.badSession,
    DisconnectReason.forbidden,
    DisconnectReason.multideviceMismatch,
  ])(
    'does not reconnect, erase credentials or automatically pair after permanent disconnect %s',
    async (code) => {
      await saveRegisteredCredentials();
      const original = await readFile(join(authDirectory, 'creds.json'), 'utf8');
      const { session, makeSocket, sockets } = harness({ allowPairing: false });
      await session.start();
      vi.useFakeTimers();
      closeWith(sockets[0].events, code);
      await vi.advanceTimersByTimeAsync(60000);
      await session.start();
      expect(session.state).toBe('logged-out');
      expect(makeSocket).toHaveBeenCalledTimes(1);
      expect(await readFile(join(authDirectory, 'creds.json'), 'utf8')).toBe(original);
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it('bounds consecutive reconnects and cancels pending reconnects on shutdown', async () => {
    const { session, makeSocket, sockets } = harness(
      {},
      { reconnectDelayMs: 20, maxReconnectAttempts: 2 }
    );
    await session.start();
    vi.useFakeTimers();
    makeSocket.mockImplementation(() => {
      throw new Error('private-provider-secret');
    });
    closeWith(sockets[0].events, DisconnectReason.connectionLost);
    await vi.advanceTimersByTimeAsync(1000);
    expect(makeSocket).toHaveBeenCalledTimes(3);
    expect(session.state).toBe('disconnected');
    expect(vi.getTimerCount()).toBe(0);
    await session.stop();
    await vi.advanceTimersByTimeAsync(60000);
    expect(makeSocket).toHaveBeenCalledTimes(3);
  });

  it('reports expired QR pairing after bounded reconnects without reopening a socket', async () => {
    const onQr = vi.fn();
    const { session, makeSocket, sockets } = harness(
      { onQr },
      { reconnectDelayMs: 10, maxReconnectAttempts: 2 }
    );
    await session.start();
    vi.useFakeTimers();
    sockets[0].events.emit('connection.update', { qr: 'fixture-private-pairing-qr' });
    for (let round = 0; round < 3; round++) {
      closeWith(sockets[round].events, DisconnectReason.timedOut);
      if (round < 2) {
        expect(session.state).toBe('disconnected');
        await vi.advanceTimersByTimeAsync(10 * 2 ** round);
        expect(session.state).toBe('linking');
      }
    }
    expect(session.state).toBe('pairing-expired');
    expect(onQr).toHaveBeenLastCalledWith(null);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60000);
    expect(makeSocket).toHaveBeenCalledTimes(3);
    expect(await session.sendText('+821012345678', 'fixture')).toEqual({
      status: 'failed',
      reason: 'not-connected',
    });
    expect(sockets.every(({ sendMessage }) => sendMessage.mock.calls.length === 0)).toBe(true);
  });

  it.each([
    { registered: false, qrIssued: false, allowPairing: true },
    { registered: true, qrIssued: true, allowPairing: true },
    { registered: true, qrIssued: false, allowPairing: false },
  ])(
    'keeps exhausted network failures distinct from expired pairing: %j',
    async ({ registered, qrIssued, allowPairing }) => {
      if (registered) await saveRegisteredCredentials();
      const { session, makeSocket, sockets } = harness(
        { allowPairing },
        { maxReconnectAttempts: 0 }
      );
      await session.start();
      vi.useFakeTimers();
      if (qrIssued) sockets[0].events.emit('connection.update', { qr: 'fixture-private-qr' });
      closeWith(sockets[0].events, DisconnectReason.connectionLost);
      expect(session.state).toBe('disconnected');
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(60000);
      expect(makeSocket).toHaveBeenCalledTimes(1);
    }
  );

  it('resets QR issuance history only when starting a new session attempt', async () => {
    const { session, makeSocket, sockets } = harness({}, { maxReconnectAttempts: 0 });
    await session.start();
    sockets[0].events.emit('connection.update', { qr: 'fixture-private-qr' });
    closeWith(sockets[0].events, DisconnectReason.timedOut);
    expect(session.state).toBe('pairing-expired');
    await session.stop();
    await session.start();
    closeWith(sockets[1].events, DisconnectReason.connectionLost);
    expect(session.state).toBe('disconnected');
    expect(makeSocket).toHaveBeenCalledTimes(2);
  });

  it('preserves permanent logout after issuing a QR even when reconnects are exhausted', async () => {
    const { session, makeSocket, sockets } = harness({}, { maxReconnectAttempts: 0 });
    await session.start();
    vi.useFakeTimers();
    sockets[0].events.emit('connection.update', { qr: 'fixture-private-qr' });
    closeWith(sockets[0].events, DisconnectReason.badSession);
    expect(session.state).toBe('logged-out');
    await vi.advanceTimersByTimeAsync(60000);
    expect(makeSocket).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels a scheduled reconnect before it can open another socket', async () => {
    const { session, makeSocket, sockets } = harness();
    await session.start();
    vi.useFakeTimers();
    closeWith(sockets[0].events, DisconnectReason.connectionClosed);
    expect(vi.getTimerCount()).toBe(1);
    await session.stop();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60000);
    expect(makeSocket).toHaveBeenCalledTimes(1);
  });

  it('does not retry when another socket replaced this connection', async () => {
    const { session, makeSocket, sockets } = harness();
    await session.start();
    vi.useFakeTimers();
    closeWith(sockets[0].events, DisconnectReason.connectionReplaced);
    await vi.advanceTimersByTimeAsync(60000);
    expect(session.state).toBe('disconnected');
    expect(makeSocket).toHaveBeenCalledTimes(1);
  });

  it('acknowledges one outbound text without promising delivery and serializes concurrent sends', async () => {
    const { session, sockets } = harness();
    await session.start();
    sockets[0].events.emit('connection.update', { connection: 'open' });
    const first = deferred<ReturnType<typeof acknowledgment>>();
    sockets[0].sendMessage
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(acknowledgment('SC_ACK_2'));
    const request1 = session.sendText('+821012345678', 'First stock signal');
    const request2 = session.sendText('821012345678', 'Second stock signal');
    await vi.waitFor(() => expect(sockets[0].sendMessage).toHaveBeenCalledTimes(1));
    expect(sockets[0].sendMessage).toHaveBeenCalledWith('821012345678@s.whatsapp.net', {
      text: 'First stock signal',
    });
    first.resolve(acknowledgment('SC_ACK_1'));
    expect(await request1).toEqual({ status: 'accepted', messageId: 'SC_ACK_1' });
    expect(await request2).toEqual({ status: 'accepted', messageId: 'SC_ACK_2' });
    expect(sockets[0].sendMessage).toHaveBeenCalledTimes(2);
  });

  it.each([
    { to: '8210', text: 'fixture', reason: 'invalid-recipient' },
    { to: '+0821012345678', text: 'fixture', reason: 'invalid-recipient' },
    { to: '821012345678@s.whatsapp.net', text: 'fixture', reason: 'invalid-recipient' },
    { to: '+821012345678\n', text: 'fixture', reason: 'invalid-recipient' },
    { to: '+821012345678', text: ' ', reason: 'invalid-text' },
    { to: '+821012345678', text: 'a'.repeat(4097), reason: 'invalid-text' },
    { to: '+821012345678', text: '\ud800', reason: 'invalid-text' },
  ])(
    'rejects invalid outbound input before calling the socket: $reason',
    async ({ to, text, reason }) => {
      const { session, sockets } = harness();
      await session.start();
      sockets[0].events.emit('connection.update', { connection: 'open' });
      expect(await session.sendText(to, text)).toEqual({ status: 'failed', reason });
      expect(sockets[0].sendMessage).not.toHaveBeenCalled();
    }
  );

  it('returns a safe failure for provider rejection and malformed acknowledgment without retrying', async () => {
    const { session, sockets } = harness();
    await session.start();
    sockets[0].events.emit('connection.update', { connection: 'open' });
    sockets[0].sendMessage.mockRejectedValueOnce(new Error('private-token recipient=821012345678'));
    const rejected = await session.sendText('+821012345678', 'fixture');
    expect(rejected).toEqual({ status: 'failed', reason: 'send-error' });
    expect(JSON.stringify(rejected)).not.toMatch(/private-token|821012345678/);
    sockets[0].sendMessage.mockResolvedValueOnce(
      acknowledgment('private-token recipient=821012345678')
    );
    expect(await session.sendText('+821012345678', 'fixture')).toEqual({
      status: 'failed',
      reason: 'send-error',
    });
    expect(sockets[0].sendMessage).toHaveBeenCalledTimes(2);
  });

  it('times out ambiguous sends without retrying or releasing the live auth lease before settlement', async () => {
    const { session, makeSocket, sockets } = harness(
      {},
      { sendTimeoutMs: 50, reconnectDelayMs: 10 }
    );
    await session.start();
    sockets[0].events.emit('connection.update', { connection: 'open' });
    const pending = deferred<ReturnType<typeof acknowledgment>>();
    sockets[0].sendMessage.mockReturnValueOnce(pending.promise);
    vi.useFakeTimers();
    const first = session.sendText('+821012345678', 'ambiguous fixture');
    const queued = session.sendText('+821012345678', 'queued fixture');
    await vi.advanceTimersByTimeAsync(100);
    expect(await first).toEqual({ status: 'failed', reason: 'send-timeout' });
    expect(await queued).toEqual({ status: 'failed', reason: 'send-timeout' });
    expect(sockets[0].sendMessage).toHaveBeenCalledTimes(1);
    expect(makeSocket).toHaveBeenCalledTimes(1);
    await session.stop();
    expect(vi.getTimerCount()).toBe(0);
    const rival = harness();
    await expect(rival.session.start()).rejects.toThrow('WhatsApp session could not be started');
    expect(rival.makeSocket).not.toHaveBeenCalled();
    pending.resolve(acknowledgment('SC_LATE_ACK'));
    await vi.waitFor(async () =>
      expect(await readdir(authDirectory)).not.toContain('.session-lock')
    );
    expect(await first).toEqual({ status: 'failed', reason: 'send-timeout' });
    await rival.session.start();
    expect(rival.makeSocket).toHaveBeenCalledTimes(1);
    expect(makeSocket).toHaveBeenCalledTimes(1);
  });

  it('cancels queued sends on shutdown and ignores late socket events', async () => {
    const { session, makeSocket, sockets } = harness();
    await session.start();
    sockets[0].events.emit('connection.update', { connection: 'open' });
    const first = deferred<ReturnType<typeof acknowledgment>>();
    sockets[0].sendMessage.mockReturnValueOnce(first.promise);
    const sending = session.sendText('+821012345678', 'fixture first');
    const queued = session.sendText('+821012345678', 'fixture queued');
    await vi.waitFor(() => expect(sockets[0].sendMessage).toHaveBeenCalledTimes(1));
    await session.stop();
    expect(await sending).toEqual({ status: 'failed', reason: 'not-connected' });
    expect(await queued).toEqual({ status: 'failed', reason: 'not-connected' });
    sockets[0].events.emit('connection.update', { connection: 'open', qr: 'late-private-qr' });
    expect(session.state).toBe('unlinked');
    first.resolve(acknowledgment());
    await vi.waitFor(async () =>
      expect(await readdir(authDirectory)).not.toContain('.session-lock')
    );
    expect(makeSocket).toHaveBeenCalledTimes(1);
    expect(sockets[0].sendMessage).toHaveBeenCalledTimes(1);
  });

  it('handles simultaneous start and shutdown without leaking a socket or lock', async () => {
    const { session, makeSocket } = harness();
    await Promise.all([session.start(), session.stop()]);
    expect(makeSocket).not.toHaveBeenCalled();
    expect(await readdir(authDirectory)).not.toContain('.session-lock');
    expect(session.state).toBe('unlinked');
  });

  it('rejects late auth-store writes after releasing the session lock', async () => {
    const { session, sockets } = harness();
    await session.start();
    const oldKeys = sockets[0].configuration.auth.keys;
    await session.stop();
    await expect(oldKeys.set({ session: { fixture: new Uint8Array([1]) } })).rejects.toThrow(
      'storage is closed'
    );
    expect(await readdir(authDirectory)).toEqual([]);
    const replacement = harness();
    await replacement.session.start();
    await expect(oldKeys.get('session', ['fixture'])).rejects.toThrow('storage is closed');
    expect(replacement.makeSocket).toHaveBeenCalledTimes(1);
  });

  it('shares one startup and prevents two session instances using the same auth directory', async () => {
    const first = harness();
    await Promise.all([first.session.start(), first.session.start()]);
    expect(first.makeSocket).toHaveBeenCalledTimes(1);
    const second = harness();
    await expect(second.session.start()).rejects.toThrow('WhatsApp session could not be started');
    expect(second.makeSocket).not.toHaveBeenCalled();
    await first.session.stop();
    await second.session.start();
    expect(second.makeSocket).toHaveBeenCalledTimes(1);
  });

  it('keeps a different live process lease and recovers it after that process exits', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
    children.push(child);
    await once(child, 'spawn');
    const lock = join(authDirectory, '.session-lock');
    await mkdir(lock, { recursive: true, mode: 0o700 });
    const token = randomUUID();
    await writeFile(join(lock, 'owner.json'), JSON.stringify({ pid: child.pid, token }), {
      mode: 0o600,
    });
    const { session, makeSocket } = harness();
    await expect(session.start()).rejects.toThrow('WhatsApp session could not be started');
    expect(JSON.parse(await readFile(join(lock, 'owner.json'), 'utf8')).token).toBe(token);
    expect(makeSocket).not.toHaveBeenCalled();
    const exited = once(child, 'exit');
    child.kill();
    await exited;
    await session.start();
    expect(makeSocket).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await readFile(join(lock, 'owner.json'), 'utf8')).pid).toBe(process.pid);
    expect(await readdir(authDirectory)).toContain(`.session-stale-${token}`);
  });

  it('admits one concurrent stale-lock recoverer and preserves its fresh live owner', async () => {
    const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
    children.push(child);
    await once(child, 'exit');
    const lock = join(authDirectory, '.session-lock');
    await mkdir(lock, { recursive: true, mode: 0o700 });
    const token = randomUUID();
    await writeFile(join(lock, 'owner.json'), JSON.stringify({ pid: child.pid, token }), {
      mode: 0o600,
    });
    const first = harness();
    const second = harness();
    const outcomes = await Promise.allSettled([first.session.start(), second.session.start()]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(first.makeSocket.mock.calls.length + second.makeSocket.mock.calls.length).toBe(1);
    const fresh = JSON.parse(await readFile(join(lock, 'owner.json'), 'utf8'));
    expect(fresh.pid).toBe(process.pid);
    expect(fresh.token).not.toBe(token);
    await (outcomes[0].status === 'rejected' ? first.session : second.session).stop();
    expect(JSON.parse(await readFile(join(lock, 'owner.json'), 'utf8')).token).toBe(fresh.token);
  });

  it.each(['directory', 'credentials', 'signal-key'])(
    'rejects a symlink in private auth storage: %s',
    async (kind) => {
      const target = join(root, 'outside');
      await mkdir(target);
      await writeFile(join(target, 'unchanged.json'), '{"fixture":"outside"}');
      if (kind === 'directory') await symlink(target, authDirectory);
      else {
        await mkdir(authDirectory);
        await symlink(
          join(target, 'unchanged.json'),
          join(authDirectory, kind === 'credentials' ? 'creds.json' : 'session-fixture.json')
        );
      }
      const { session, makeSocket } = harness();
      await expect(session.start()).rejects.toThrow('WhatsApp session could not be started');
      expect(makeSocket).not.toHaveBeenCalled();
      expect(await readFile(join(target, 'unchanged.json'), 'utf8')).toBe('{"fixture":"outside"}');
    }
  );

  it.skipIf(process.platform === 'win32')(
    'rejects a FIFO lock owner without blocking startup',
    async () => {
      const lock = join(authDirectory, '.session-lock');
      await mkdir(lock, { recursive: true, mode: 0o700 });
      await new Promise<void>((resolveCommand, reject) => {
        execFile('mkfifo', [join(lock, 'owner.json')], (error) => {
          if (error) reject(error);
          else resolveCommand();
        });
      });
      const { session, makeSocket } = harness();
      await expect(session.start()).rejects.toThrow('WhatsApp session could not be started');
      expect(makeSocket).not.toHaveBeenCalled();
    }
  );

  it.each(['null', 'false', '{broken-json', '{"registered":"yes","token":"private-fixture"}'])(
    'does not silently replace corrupt credentials or reveal their content: %s',
    async (content) => {
      await mkdir(authDirectory);
      await writeFile(join(authDirectory, 'creds.json'), content);
      const { session, makeSocket } = harness();
      let failure: unknown;
      try {
        await session.start();
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      expect(String(failure)).not.toContain('private-fixture');
      expect(makeSocket).not.toHaveBeenCalled();
      expect(await readFile(join(authDirectory, 'creds.json'), 'utf8')).toBe(content);
    }
  );
});
