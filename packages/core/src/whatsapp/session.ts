import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  chmod,
  type FileHandle,
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  unlink,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import makeWASocket, {
  type AuthenticationCreds,
  type AuthenticationState,
  BufferJSON,
  type ConnectionState,
  DisconnectReason,
  initAuthCreds,
  jidDecode,
  proto,
  type SignalDataTypeMap,
  type WASocket,
} from '@whiskeysockets/baileys';
import pino from 'pino';

export type WhatsAppSessionState =
  | 'unlinked'
  | 'linking'
  | 'connected'
  | 'disconnected'
  | 'pairing-expired'
  | 'logged-out';

export type WhatsAppSessionSendResult =
  | { status: 'accepted'; messageId: string }
  | {
      status: 'failed';
      reason:
        | 'not-connected'
        | 'invalid-recipient'
        | 'invalid-text'
        | 'send-timeout'
        | 'send-error';
    };

export type WhatsAppSessionDiagnostic =
  | { event: 'companion-registration-refresh'; validChild: boolean }
  | { event: 'pairing-success' }
  | { event: 'disconnect'; statusCode?: number };

export interface WhatsAppSessionOptions {
  authDirectory: string;
  /** Only the explicit linking command may start a new QR pairing. */
  allowPairing?: boolean;
  onQr?: (qr: string | null) => void;
  onState?: (state: WhatsAppSessionState) => void;
  onDiagnostic?: (diagnostic: WhatsAppSessionDiagnostic) => void;
}

export interface WhatsAppSession {
  readonly state: WhatsAppSessionState;
  start(): Promise<void>;
  stop(): Promise<void>;
  sendText(to: string, text: string): Promise<WhatsAppSessionSendResult>;
}

type SessionSocket = Pick<WASocket, 'ev' | 'sendMessage' | 'end'> & {
  ws?: Pick<WASocket['ws'], 'on' | 'off'>;
};

export interface WhatsAppSessionDependencies {
  /** Offline tests provide sockets and may shorten timers. */
  makeSocket?: (options: Parameters<typeof makeWASocket>[0]) => SessionSocket;
  sendTimeoutMs?: number;
  reconnectDelayMs?: number;
  maxReconnectAttempts?: number;
}

interface SessionOwner {
  pid: number;
  token: string;
}

function isMissing(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (info.isSymbolicLink() || !info.isDirectory())
    throw new Error('Invalid WhatsApp auth directory.');
  await chmod(directory, 0o700);
  for (const name of await readdir(directory)) {
    const file = join(directory, name);
    const entry = await lstat(file);
    if (entry.isSymbolicLink()) throw new Error('Invalid WhatsApp auth directory.');
    if (entry.isFile()) await chmod(file, 0o600);
    else if (!entry.isDirectory() || !/^\.session-(?:lock|prepared-|stale-|released-)/.test(name)) {
      throw new Error('Invalid WhatsApp auth directory.');
    }
  }
}

async function readPrivateJson(file: string): Promise<unknown | null> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    if (!(await handle.stat()).isFile()) throw new Error('Invalid WhatsApp auth file.');
    await handle.chmod(0o600);
    const value = JSON.parse(await handle.readFile('utf8'), BufferJSON.reviver);
    if (value === null) throw new Error('Invalid WhatsApp auth file.');
    return value;
  } catch (error) {
    if (isMissing(error)) return null;
    throw new Error('Invalid WhatsApp auth file.');
  } finally {
    await handle?.close();
  }
}

async function writePrivateJson(directory: string, name: string, value: unknown): Promise<void> {
  const file = join(directory, name);
  const current = await lstat(file).catch((error) => {
    if (isMissing(error)) return null;
    throw error;
  });
  if (current && (!current.isFile() || current.isSymbolicLink())) {
    throw new Error('Invalid WhatsApp auth file.');
  }
  const temporary = join(directory, `.auth-${randomUUID()}.tmp`);
  const handle = await open(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600
  );
  try {
    await handle.writeFile(JSON.stringify(value, BufferJSON.replacer));
    await handle.sync();
    await handle.close();
    await rename(temporary, file);
  } finally {
    await handle.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
}

function ownerIsAlive(owner: SessionOwner): boolean {
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch (error) {
    return !error || typeof error !== 'object' || !('code' in error) || error.code !== 'ESRCH';
  }
}

async function readOwner(directory: string): Promise<SessionOwner | null> {
  const info = await lstat(directory).catch((error) => {
    if (isMissing(error)) return null;
    throw error;
  });
  if (!info) return null;
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error('Invalid WhatsApp session lock.');
  const value = await readPrivateJson(join(directory, 'owner.json'));
  if (
    !value ||
    typeof value !== 'object' ||
    !('pid' in value) ||
    !('token' in value) ||
    !Number.isSafeInteger(value.pid) ||
    (value.pid as number) < 1 ||
    typeof value.token !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(value.token)
  )
    throw new Error('Invalid WhatsApp session lock.');
  return value as SessionOwner;
}

async function acquireSessionLock(directory: string): Promise<() => Promise<void>> {
  const lock = join(directory, '.session-lock');
  const owner: SessionOwner = { pid: process.pid, token: randomUUID() };
  const prepared = join(directory, `.session-prepared-${owner.token}`);
  await mkdir(prepared, { mode: 0o700 });
  try {
    await writePrivateJson(prepared, 'owner.json', owner);
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        await rename(prepared, lock);
        return async () => {
          if ((await readOwner(lock))?.token !== owner.token) return;
          const released = join(directory, `.session-released-${owner.token}`);
          await rename(lock, released);
          await rm(released, { recursive: true, force: true });
        };
      } catch (error) {
        if (
          !error ||
          typeof error !== 'object' ||
          !('code' in error) ||
          !['EEXIST', 'ENOTEMPTY'].includes(String(error.code))
        )
          throw error;
      }
      const previous = await readOwner(lock);
      if (!previous) continue;
      if (ownerIsAlive(previous)) throw new Error('WhatsApp auth directory is already in use.');
      // A nonempty tombstone prevents a delayed stale observer from moving a fresh live lock.
      await rename(lock, join(directory, `.session-stale-${previous.token}`)).catch((error) => {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          ['ENOENT', 'EEXIST', 'ENOTEMPTY'].includes(String(error.code))
        )
          return;
        throw error;
      });
    }
    throw new Error('WhatsApp auth directory is already in use.');
  } finally {
    await rm(prepared, { recursive: true, force: true });
  }
}

function disconnectCode(update: Partial<ConnectionState>): number | undefined {
  const error = update.lastDisconnect?.error;
  if (!error || !('output' in error) || !error.output || typeof error.output !== 'object') return;
  const code = 'statusCode' in error.output ? error.output.statusCode : undefined;
  return typeof code === 'number' &&
    Number.isFinite(code) &&
    Number.isInteger(code) &&
    code >= 100 &&
    code <= 999
    ? code
    : undefined;
}

function hasPairedIdentity(value: unknown): boolean {
  if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string') {
    return false;
  }
  if (!/^\d+(?:_\d+)?(?::\d+)?@(?:s\.whatsapp\.net|c\.us)$/.test(value.id)) return false;
  const identity = jidDecode(value.id);
  return (
    !!identity &&
    Number.isSafeInteger(Number(identity.user)) &&
    Number(identity.user) > 0 &&
    (identity.device === undefined ||
      (Number.isSafeInteger(identity.device) && identity.device >= 0))
  );
}

function hasPairedAuthentication(creds: AuthenticationCreds | undefined): boolean {
  // Verified QR pairing saves me/account but leaves registered=false in the SDK.
  // Pairing-code requests save me before authentication, so identity alone is insufficient.
  return (
    creds?.registered === true ||
    (hasPairedIdentity(creds?.me) &&
      !!creds?.account &&
      typeof creds.account === 'object' &&
      !Array.isArray(creds.account))
  );
}

export function createWhatsAppSession(
  options: WhatsAppSessionOptions,
  dependencies: WhatsAppSessionDependencies = {}
): WhatsAppSession {
  const directory = resolve(options.authDirectory);
  const makeSocket = dependencies.makeSocket ?? makeWASocket;
  const sendTimeoutMs = dependencies.sendTimeoutMs ?? 10000;
  const reconnectDelayMs = dependencies.reconnectDelayMs ?? 1000;
  const maxReconnectAttempts = dependencies.maxReconnectAttempts ?? 5;
  const logger = pino({ level: 'silent' });
  let state: WhatsAppSessionState = 'unlinked';
  let stopped = true;
  let socket: SessionSocket | undefined;
  let disconnectListeners: (() => void) | undefined;
  let auth: AuthenticationState | undefined;
  let releaseLock: (() => Promise<void>) | undefined;
  let releasePromise: Promise<void> | undefined;
  let startPromise: Promise<void> | undefined;
  let stopPromise: Promise<void> | undefined;
  let storageTail: Promise<void> = Promise.resolve();
  let sendTail: Promise<void> = Promise.resolve();
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectAttempts = 0;
  let qrWasIssued = false;
  let pairingSuccessReported = false;
  let generation = 0;
  const outstandingSends = new Set<Promise<unknown>>();
  const cancelSends = new Set<() => void>();

  function setState(next: WhatsAppSessionState): void {
    if (next === state) return;
    state = next;
    try {
      options.onState?.(next);
    } catch {
      /* A UI callback must not affect credentials. */
    }
  }
  function setQr(qr: string | null): void {
    try {
      options.onQr?.(qr);
    } catch {
      /* QR values are never logged or persisted. */
    }
  }
  function diagnose(diagnostic: WhatsAppSessionDiagnostic): void {
    try {
      options.onDiagnostic?.(diagnostic);
    } catch {
      // Diagnostics never alter connection or key persistence.
    }
  }
  function closeSocket(): void {
    disconnectListeners?.();
    disconnectListeners = undefined;
    const previous = socket;
    socket = undefined;
    try {
      previous?.end(new Error('WhatsApp session closed.'));
    } catch {
      /* No raw socket errors. */
    }
  }
  async function releaseWhenIdle(): Promise<void> {
    if (releasePromise) return releasePromise;
    if (!stopped || outstandingSends.size || !releaseLock) return;
    await storageTail;
    if (releasePromise) return releasePromise;
    if (!stopped || outstandingSends.size || !releaseLock) return;
    const release = releaseLock;
    releaseLock = undefined;
    releasePromise = release();
    try {
      await releasePromise;
    } finally {
      releasePromise = undefined;
    }
  }
  function store<T>(operation: () => Promise<T>): Promise<T> {
    if (!releaseLock || (stopped && !outstandingSends.size)) {
      return Promise.reject(new Error('WhatsApp authentication storage is closed.'));
    }
    const result = storageTail.then(operation);
    storageTail = result.then(
      () => {},
      () => {
        void stop().catch(() => {});
      }
    );
    return result;
  }
  function keyName(type: string, id: string): string {
    const name = `${type}-${id}.json`.replace(/[\\/]/g, '__').replace(/:/g, '-');
    if (name.length > 240 || /[\p{Cc}\p{Cf}]/u.test(name))
      throw new Error('Invalid WhatsApp auth key.');
    return name;
  }
  async function loadAuthentication(): Promise<AuthenticationState> {
    const saved = await readPrivateJson(join(directory, 'creds.json'));
    if (
      saved !== null &&
      (typeof saved !== 'object' ||
        !('registered' in saved) ||
        typeof saved.registered !== 'boolean')
    ) {
      throw new Error('Invalid WhatsApp authentication state.');
    }
    if (saved && typeof saved === 'object' && 'me' in saved && !hasPairedIdentity(saved.me)) {
      throw new Error('Invalid WhatsApp authentication state.');
    }
    const creds = (saved ?? initAuthCreds()) as AuthenticationCreds;
    return {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) =>
          store(async () => {
            const data: Record<string, SignalDataTypeMap[T]> = {};
            for (const id of ids) {
              let value = await readPrivateJson(join(directory, keyName(type, id)));
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(
                  value as Record<string, unknown>
                );
              }
              data[id] = value as SignalDataTypeMap[T];
            }
            return data;
          }),
        set: async (data) => {
          const entries = Object.entries(data).flatMap(([type, keys]) =>
            Object.entries(keys ?? {}).map(([id, value]) => ({ name: keyName(type, id), value }))
          );
          await store(async () => {
            for (const { name, value } of entries) {
              if (value === null || value === undefined) {
                const file = join(directory, name);
                const info = await lstat(file).catch((error) => {
                  if (isMissing(error)) return null;
                  throw error;
                });
                if (info?.isSymbolicLink()) throw new Error('Invalid WhatsApp auth key.');
                if (info) await unlink(file);
              } else await writePrivateJson(directory, name, value);
            }
          });
        },
      },
    };
  }
  function scheduleReconnect(code?: number): void {
    if (stopped || reconnectTimer) return;
    if (reconnectAttempts >= maxReconnectAttempts) {
      if (options.allowPairing && !hasPairedAuthentication(auth?.creds) && qrWasIssued) {
        setState('pairing-expired');
      }
      return;
    }
    reconnectAttempts++;
    const expectedGeneration = generation;
    const delay =
      code === DisconnectReason.restartRequired
        ? Math.min(reconnectDelayMs, 100)
        : Math.min(reconnectDelayMs * 2 ** (reconnectAttempts - 1), 10000);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      void connect(expectedGeneration).catch(() => {
        if (stopped || expectedGeneration !== generation) return;
        setState('disconnected');
        scheduleReconnect();
      });
    }, delay);
    reconnectTimer.unref?.();
  }
  async function connect(expectedGeneration: number): Promise<void> {
    await Promise.all([storageTail, sendTail]);
    if (stopped || expectedGeneration !== generation || socket || !auth) return;
    setState('linking');
    const current = makeSocket({
      auth,
      logger,
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      shouldIgnoreJid: () => true,
      getMessage: async () => undefined,
      enableAutoSessionRecreation: false,
      enableRecentMessageCache: false,
      maxMsgRetryCount: 0,
      connectTimeoutMs: 15000,
      defaultQueryTimeoutMs: sendTimeoutMs,
      generateHighQualityLinkPreview: false,
    });
    socket = current;
    const onConnection = (update: Partial<ConnectionState>) => {
      if (stopped || socket !== current || expectedGeneration !== generation) return;
      if (update.qr) {
        qrWasIssued = true;
        if (!options.allowPairing) {
          stopped = true;
          closeSocket();
          setQr(null);
          setState('unlinked');
          void releaseWhenIdle().catch(() => {});
          return;
        }
        setQr(update.qr);
        setState('linking');
      }
      if (update.isNewLogin === true) setQr(null);
      if (update.connection === 'open') {
        reconnectAttempts = 0;
        setQr(null);
        setState('connected');
      } else if (update.connection === 'close') {
        const code = disconnectCode(update);
        diagnose(
          code === undefined ? { event: 'disconnect' } : { event: 'disconnect', statusCode: code }
        );
        closeSocket();
        setQr(null);
        if (
          [
            DisconnectReason.loggedOut,
            DisconnectReason.badSession,
            DisconnectReason.forbidden,
            DisconnectReason.multideviceMismatch,
          ].includes(code ?? 0)
        ) {
          stopped = true;
          setState('logged-out');
          void releaseWhenIdle().catch(() => {});
        } else {
          setState('disconnected');
          if (code !== DisconnectReason.connectionReplaced) scheduleReconnect(code);
        }
      }
    };
    const onCredentials = (update: Partial<AuthenticationCreds>) => {
      if (stopped || socket !== current || !auth) return;
      try {
        Object.assign(auth.creds, update);
        const snapshot = JSON.parse(
          JSON.stringify(auth.creds, BufferJSON.replacer),
          BufferJSON.reviver
        );
        void store(() => writePrivateJson(directory, 'creds.json', snapshot)).catch(() => {});
      } catch {
        void stop().catch(() => {});
      }
    };
    current.ev.on('connection.update', onConnection);
    current.ev.on('creds.update', onCredentials);
    const diagnosticIsCurrent = () =>
      !stopped && socket === current && expectedGeneration === generation;
    const onCompanionRefresh = (node: unknown) => {
      if (!diagnosticIsCurrent() || hasPairedAuthentication(auth?.creds)) return;
      const children =
        node && typeof node === 'object' && 'content' in node ? node.content : undefined;
      const validChild =
        Array.isArray(children) &&
        children.some(
          (child: unknown) =>
            child &&
            typeof child === 'object' &&
            'tag' in child &&
            (child.tag === 'companion_reg_refresh' || child.tag === 'pair-device-rotate-qr')
        );
      diagnose({ event: 'companion-registration-refresh', validChild });
    };
    const onPairingSuccess = () => {
      if (!diagnosticIsCurrent() || pairingSuccessReported) return;
      pairingSuccessReported = true;
      diagnose({ event: 'pairing-success' });
    };
    current.ws?.on('CB:notification,type:companion_reg_refresh', onCompanionRefresh);
    current.ws?.on('CB:iq,,pair-success', onPairingSuccess);
    disconnectListeners = () => {
      current.ev.off('connection.update', onConnection);
      current.ev.off('creds.update', onCredentials);
      current.ws?.off('CB:notification,type:companion_reg_refresh', onCompanionRefresh);
      current.ws?.off('CB:iq,,pair-success', onPairingSuccess);
    };
  }
  async function start(): Promise<void> {
    if (startPromise) return startPromise;
    if (!stopped || state === 'logged-out') return;
    if (releaseLock || releasePromise) throw new Error('WhatsApp auth directory is still in use.');
    const currentGeneration = ++generation;
    reconnectAttempts = 0;
    qrWasIssued = false;
    pairingSuccessReported = false;
    stopped = false;
    startPromise = (async () => {
      try {
        await ensurePrivateDirectory(directory);
        releaseLock = await acquireSessionLock(directory);
        auth = await loadAuthentication();
        if (stopped || currentGeneration !== generation) {
          await releaseWhenIdle();
          return;
        }
        if (!hasPairedAuthentication(auth.creds) && !options.allowPairing) {
          stopped = true;
          setState('unlinked');
          await releaseWhenIdle();
          return;
        }
        await connect(currentGeneration);
      } catch {
        stopped = true;
        closeSocket();
        setQr(null);
        setState('disconnected');
        await releaseWhenIdle().catch(() => {});
        throw new Error(
          'WhatsApp session could not be started. Check the private auth directory and active gateway.'
        );
      }
    })();
    try {
      await startPromise;
    } finally {
      startPromise = undefined;
    }
  }
  async function stop(): Promise<void> {
    if (stopPromise) return stopPromise;
    stopped = true;
    generation++;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    closeSocket();
    setQr(null);
    if (state !== 'logged-out') {
      setState(hasPairedAuthentication(auth?.creds) ? 'disconnected' : 'unlinked');
    }
    for (const cancel of cancelSends) cancel();
    stopPromise = (async () => {
      await storageTail;
      await releaseWhenIdle();
    })();
    try {
      await stopPromise;
    } finally {
      stopPromise = undefined;
    }
  }
  async function sendText(to: string, text: string): Promise<WhatsAppSessionSendResult> {
    if (typeof to !== 'string' || !/^\+?[1-9]\d{7,14}$/.test(to))
      return { status: 'failed', reason: 'invalid-recipient' };
    if (typeof text !== 'string' || !text.trim() || text.length > 4096 || !text.isWellFormed()) {
      return { status: 'failed', reason: 'invalid-text' };
    }
    if (stopped || state !== 'connected' || !socket)
      return { status: 'failed', reason: 'not-connected' };
    return new Promise<WhatsAppSessionSendResult>((resolveResult) => {
      let finished = false;
      let activeSocket: SessionSocket | undefined;
      const finish = (result: WhatsAppSessionSendResult) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        cancelSends.delete(cancel);
        resolveResult(result);
      };
      const cancel = () => finish({ status: 'failed', reason: 'not-connected' });
      const timer = setTimeout(() => {
        finish({ status: 'failed', reason: 'send-timeout' });
        if (activeSocket && socket === activeSocket) {
          closeSocket();
          setState('disconnected');
          scheduleReconnect();
        }
      }, sendTimeoutMs);
      timer.unref?.();
      cancelSends.add(cancel);
      sendTail = sendTail
        .then(async () => {
          if (finished) return;
          if (stopped || state !== 'connected' || !socket) {
            cancel();
            return;
          }
          activeSocket = socket;
          const operation = Promise.resolve().then(() =>
            activeSocket?.sendMessage(`${to.replace(/^\+/, '')}@s.whatsapp.net`, { text })
          );
          outstandingSends.add(operation);
          try {
            const response = await operation;
            const messageId = response?.key.id;
            if (typeof messageId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(messageId)) {
              finish({ status: 'accepted', messageId });
            } else finish({ status: 'failed', reason: 'send-error' });
          } catch {
            finish({ status: 'failed', reason: 'send-error' });
          } finally {
            outstandingSends.delete(operation);
            void releaseWhenIdle().catch(() => {});
          }
        })
        .catch(() => {
          finish({ status: 'failed', reason: 'send-error' });
        });
    });
  }
  return {
    get state() {
      return state;
    },
    start,
    stop,
    sendText,
  };
}
