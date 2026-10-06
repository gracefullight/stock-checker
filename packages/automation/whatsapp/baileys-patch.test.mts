import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { type TestContext, test } from 'node:test';
import { pathToFileURL, URL } from 'node:url';
import { promisify } from 'node:util';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';

const coreRequire = createRequire(new URL('../../core/package.json', import.meta.url));
const sdkRoot = path.resolve(coreRequire.resolve('@whiskeysockets/baileys'), '../..');
const browser = ['Mac OS', 'Chrome', 'fixture-version'];

interface FixtureNode {
  tag: string;
  attrs: Record<string, string>;
  content?: FixtureNode[] | Uint8Array;
}

interface Credentials {
  registered: boolean;
  noiseKey: { public: Buffer };
  signedIdentityKey: { public: Buffer };
  advSecretKey: string;
  me?: { id: string };
}

interface FakeTimer {
  number: number;
  delay: number;
  callback: () => void;
}

interface PairingSocket {
  ws: FakeWebSocket;
  end(): void | Promise<void>;
}

interface PairingModule {
  makeSocket(config: Record<string, unknown>): PairingSocket;
}

interface AcknowledgementSocket {
  authState: { creds: Credentials };
  sendMessageAck(node: FixtureNode): Promise<void>;
}

interface AcknowledgementModule {
  makeMessagesRecvSocket(config: Record<string, unknown>): AcknowledgementSocket;
}

class FakeEvents extends EventEmitter {
  buffer() {}
  flush() {}
  destroy() {}
}

class FakeWebSocket extends EventEmitter {
  isOpen: boolean;
  isClosed: boolean;
  isClosing: boolean;
  sent: FixtureNode[];
  pending: Promise<unknown>[];

  constructor() {
    super();
    this.isOpen = true;
    this.isClosed = false;
    this.isClosing = false;
    this.sent = [];
    this.pending = [];
  }
  connect() {}
  send(node: FixtureNode, callback?: (error: null) => void) {
    this.sent.push(node);
    callback?.(null);
    return true;
  }
  async close() {
    this.isOpen = false;
    this.isClosed = true;
  }
  emit(event: string | symbol, ...arguments_: unknown[]) {
    const listeners = this.rawListeners(event);
    for (const listener of listeners) {
      const callback = listener as (...arguments_: unknown[]) => Promise<unknown> | undefined;
      const result = callback.apply(this, arguments_);
      if (result?.then) {
        // Every SDK callback rejection remains observable by the offline test.
        this.pending.push(Promise.resolve(result));
        result.catch(() => {});
      }
    }
    return listeners.length > 0;
  }
  async receive(node: FixtureNode) {
    this.emit('message', node);
    await this.drain();
  }
  async drain() {
    while (this.pending.length) await Promise.all(this.pending.splice(0));
  }
}

function fakeTimers() {
  const active = new Map<FakeTimer, FakeTimer>();
  let scheduled = 0;
  return {
    active,
    get scheduled() {
      return scheduled;
    },
    setTimeout(callback: () => void, delay: number) {
      const timer = { number: ++scheduled, delay, callback };
      active.set(timer, timer);
      return timer;
    },
    clearTimeout(timer: FakeTimer) {
      active.delete(timer);
    },
    next() {
      const timer = active.values().next().value;
      assert.ok(timer, 'Expected a pending SDK timer');
      active.delete(timer);
      timer.callback();
    },
  };
}

async function evaluateInstalledModule<Namespace>(
  relativePath: string,
  supplied: Record<string, Record<string, unknown>>,
  globals: Record<string, unknown> = {}
): Promise<Namespace> {
  const filename = path.join(sdkRoot, relativePath);
  const source = await fs.readFile(filename, 'utf8');
  const context = createContext({ Buffer, URL, process, console, ...globals });
  const module = new SourceTextModule(source, {
    context,
    identifier: pathToFileURL(filename).href,
  });
  // Mock external capabilities while executing the installed SDK source itself.
  // Import names are wiring metadata, never assertions about patch text.
  const imports = new Map<string, string[]>();
  for (const match of source.matchAll(/^import (.+?) from ['"](.+?)['"];?$/gm)) {
    const names = match[1].startsWith('{')
      ? match[1]
          .slice(1, -1)
          .split(',')
          .map((name) => name.trim().split(/\s+as\s+/)[0])
      : ['default'];
    imports.set(match[2], [...new Set([...(imports.get(match[2]) ?? []), ...names])]);
  }
  await module.link((specifier) => {
    const names = imports.get(specifier);
    assert.ok(names, `Unexpected SDK import: ${specifier}`);
    const exports = supplied[specifier] ?? {};
    return new SyntheticModule(
      names,
      function setExports() {
        for (const name of names) {
          this.setExport(
            name,
            Object.hasOwn(exports, name)
              ? exports[name]
              : () => {
                  throw new Error(`Unexpected SDK dependency call: ${specifier}:${name}`);
                }
          );
        }
      },
      { context, identifier: `${filename}:${specifier}` }
    );
  });
  await module.evaluate();
  return module.namespace as Namespace;
}

function creds(): Credentials {
  return {
    registered: false,
    noiseKey: { public: Buffer.alloc(32, 1) },
    signedIdentityKey: { public: Buffer.alloc(32, 2) },
    advSecretKey: Buffer.alloc(32, 3).toString('base64'),
  };
}

function logger() {
  const errors: unknown[] = [];
  return {
    level: 'silent',
    errors,
    trace() {},
    debug() {},
    info() {},
    warn() {},
    error(error: unknown) {
      errors.push(error);
    },
  };
}

function children(node: FixtureNode | undefined, tag?: string): FixtureNode[] {
  return Array.isArray(node?.content)
    ? node.content.filter((child) => !tag || child.tag === tag)
    : [];
}

async function pairingHarness(t: TestContext) {
  const events = new FakeEvents();
  const timers = fakeTimers();
  const credentials = creds();
  const updates: string[] = [];
  const credentialUpdates: Partial<Credentials>[] = [];
  const timeline: string[] = [];
  const helpers = await import(
    pathToFileURL(path.join(sdkRoot, 'lib/Utils/companion-reg-client-utils.js')).href
  );
  const namespace = await evaluateInstalledModule<PairingModule>(
    'lib/Socket/socket.js',
    {
      '@hapi/boom': {
        Boom: class extends Error {
          output: { statusCode?: number };

          constructor(message: string, options?: { statusCode?: number }) {
            super(message);
            this.output = { statusCode: options?.statusCode };
          }
        },
      },
      crypto: { randomBytes: crypto.randomBytes },
      url: { URL },
      util: { promisify },
      '../../WAProto/index.js': { proto: {} },
      '../Defaults/index.js': {
        PROCESSABLE_HISTORY_TYPES: [],
        DEF_CALLBACK_PREFIX: 'CB:',
        DEF_TAG_PREFIX: 'TAG:',
        TimeMs: { Day: 86400000, Week: 604800000 },
      },
      '../Types/index.js': { DisconnectReason: { timedOut: 408 } },
      '../Utils/index.js': {
        Curve: { generateKeyPair: () => ({ public: Buffer.alloc(32), private: Buffer.alloc(32) }) },
        makeNoiseHandler: () => ({
          encodeFrame: (value: FixtureNode) => value,
          decodeFrame: async (value: FixtureNode, callback: (node: FixtureNode) => unknown) =>
            callback(value),
        }),
        generateMdTagPrefix: () => 'fixture-',
        makeEventBuffer: () => events,
        promiseTimeout: (
          _milliseconds: number,
          callback: (
            resolve: (value: unknown) => void,
            reject: (reason: unknown) => void
          ) => unknown
        ) =>
          new Promise((resolve, reject) => {
            Promise.resolve(callback(resolve, reject)).catch(reject);
          }),
        addTransactionCapability: (keys: unknown) => keys,
        buildPairingQRData: helpers.buildPairingQRData,
        configureSuccessfulPairing: () => ({
          reply: { tag: 'iq', attrs: { id: 'fixture-pair-success' } },
          creds: { me: { id: 'fixture-device@s.whatsapp.net' }, registered: true },
        }),
        bindWaitForConnectionUpdate: () => () => {},
      },
      '../WABinary/index.js': {
        encodeBinaryNode: (node: FixtureNode) => node,
        getBinaryNodeChild: (node: FixtureNode, tag: string) => children(node, tag)[0],
        getBinaryNodeChildren: children,
        S_WHATSAPP_NET: '@s.whatsapp.net',
      },
      '../WAM/BinaryInfo.js': { BinaryInfo: class {} },
      './Client/index.js': { WebSocketClient: FakeWebSocket },
    },
    {
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      setInterval: timers.setTimeout,
      clearInterval: timers.clearTimeout,
    }
  );
  const socket = namespace.makeSocket({
    waWebSocketUrl: 'wss://fixture.invalid',
    connectTimeoutMs: 1000,
    keepAliveIntervalMs: 30000,
    browser,
    logger: logger(),
    auth: { creds: credentials, keys: {} },
    transactionOpts: {},
    shouldSyncHistoryMessage: () => true,
    makeSignalRepository: () => ({ close() {} }),
  });
  events.on('connection.update', (update: { qr?: string }) => {
    if (update.qr) {
      updates.push(update.qr);
      timeline.push('qr');
    }
  });
  events.on('creds.update', (update: Partial<Credentials>) => {
    credentialUpdates.push(update);
    timeline.push('creds');
  });
  t.after(() => socket.end());
  return { socket, credentials, updates, credentialUpdates, timers, timeline };
}

function pairingRefs(refs = ['fixture-ref-1', 'fixture-ref-2']): FixtureNode {
  return {
    tag: 'iq',
    attrs: { type: 'set', id: 'fixture-pair-id', from: '@s.whatsapp.net' },
    content: [
      {
        tag: 'pair-device',
        attrs: {},
        content: refs.map((ref) => ({ tag: 'ref', attrs: {}, content: Buffer.from(ref) })),
      },
    ],
  };
}

function refresh(child = 'companion_reg_refresh'): FixtureNode {
  return {
    tag: 'notification',
    attrs: { type: 'companion_reg_refresh', id: 'fixture-refresh-id', from: '@s.whatsapp.net' },
    content: [{ tag: child, attrs: {} }],
  };
}

function qrFields(qr: string) {
  const prefix = 'https://wa.me/settings/linked_devices#';
  assert.ok(qr.startsWith(prefix));
  const fields = qr.slice(prefix.length).split(',');
  assert.equal(fields.length, 5);
  return fields;
}

test('refresh rotates an unpaired ADV secret, re-renders the same ref and preserves its timer', async (t) => {
  for (const child of ['companion_reg_refresh', 'pair-device-rotate-qr']) {
    const setup = await pairingHarness(t);
    await setup.socket.ws.receive(pairingRefs());
    const original = qrFields(setup.updates[0]);
    const timer = [...setup.timers.active.keys()][0];
    const scheduled = setup.timers.scheduled;
    setup.timeline.length = 0;
    await setup.socket.ws.receive(refresh(child));
    assert.equal(setup.updates.length, 2);
    const next = qrFields(setup.updates[1]);
    assert.equal(next[0], original[0]);
    assert.equal(next[1], original[1]);
    assert.equal(next[2], original[2]);
    assert.equal(next[4], original[4]);
    assert.notEqual(next[3], original[3]);
    assert.equal(Buffer.from(next[3], 'base64').length, 32);
    assert.equal(setup.credentialUpdates.at(-1)!.advSecretKey, next[3]);
    assert.equal(setup.credentials.advSecretKey, next[3]);
    assert.deepEqual(setup.timeline, ['creds', 'qr']);
    assert.equal(setup.credentials.registered, false);
    assert.equal(setup.timers.scheduled, scheduled);
    assert.equal([...setup.timers.active.keys()][0], timer);
    assert.equal(timer.delay, 60000);
  }
});

test('future refs use the live secret and refresh bursts do not consume the bounded ref pool', async (t) => {
  const setup = await pairingHarness(t);
  await setup.socket.ws.receive(pairingRefs());
  for (let index = 0; index < 50; index++) await setup.socket.ws.receive(refresh());
  assert.equal(setup.timers.scheduled, 1);
  const currentSecret = setup.credentials.advSecretKey;
  assert.notEqual(currentSecret, qrFields(setup.updates[0])[3]);
  setup.timers.next();
  assert.equal(qrFields(setup.updates.at(-1)!)[0], 'fixture-ref-2');
  assert.equal(qrFields(setup.updates.at(-1)!)[3], currentSecret);
  assert.equal([...setup.timers.active.keys()][0].delay, 20000);
  const count = setup.updates.length;
  setup.timers.next();
  await setup.socket.ws.drain();
  assert.equal(setup.updates.length, count);
  assert.equal(setup.socket.ws.isClosed, true);
  assert.equal(setup.timers.active.size, 0);
});

test('malformed refresh children leave the existing secret, QR and timers untouched', async (t) => {
  const setup = await pairingHarness(t);
  await setup.socket.ws.receive(pairingRefs());
  const originalSecret = setup.credentials.advSecretKey;
  const originalTimer = [...setup.timers.active.keys()][0];
  for (const node of [
    refresh('unrelated'),
    { ...refresh(), content: [] },
    { ...refresh(), content: Buffer.from('invalid') },
  ]) {
    await setup.socket.ws.receive(node);
  }
  assert.equal(setup.credentials.advSecretKey, originalSecret);
  assert.equal(setup.updates.length, 1);
  assert.equal(setup.credentialUpdates.length, 0);
  assert.equal([...setup.timers.active.keys()][0], originalTimer);
});

test('registered and pending pairing-code sessions keep their existing advertisement secret', async (t) => {
  for (const authenticated of [{ registered: true }, { me: { id: 'fixture@s.whatsapp.net' } }]) {
    const setup = await pairingHarness(t);
    await setup.socket.ws.receive(pairingRefs());
    Object.assign(setup.credentials, authenticated);
    const originalSecret = setup.credentials.advSecretKey;
    await setup.socket.ws.receive(refresh());
    assert.equal(setup.credentials.advSecretKey, originalSecret);
    assert.equal(setup.updates.length, 1);
    assert.equal(setup.credentialUpdates.length, 0);
  }
});

test('outer tag and type are validated even when a malformed frame reaches the specific callback', async (t) => {
  const setup = await pairingHarness(t);
  await setup.socket.ws.receive(pairingRefs());
  const originalSecret = setup.credentials.advSecretKey;
  const originalTimer = [...setup.timers.active.keys()][0];
  for (const node of [
    { ...refresh(), tag: 'message' },
    { ...refresh(), attrs: { type: 'unrelated' } },
    { ...refresh(), attrs: undefined },
    undefined,
  ]) {
    setup.socket.ws.emit('CB:notification,type:companion_reg_refresh', node);
    await setup.socket.ws.drain();
  }
  assert.equal(setup.credentials.advSecretKey, originalSecret);
  assert.equal(setup.credentialUpdates.length, 0);
  assert.equal(setup.updates.length, 1);
  assert.equal([...setup.timers.active.keys()][0], originalTimer);
});

test('an old closed socket cannot rotate credentials or emit a new pairing QR', async (t) => {
  const setup = await pairingHarness(t);
  await setup.socket.ws.receive(pairingRefs());
  await setup.socket.end();
  const originalSecret = setup.credentials.advSecretKey;
  const count = setup.updates.length;
  setup.socket.ws.emit('CB:notification,type:companion_reg_refresh', refresh());
  await setup.socket.ws.drain();
  assert.equal(setup.credentials.advSecretKey, originalSecret);
  assert.equal(setup.credentialUpdates.length, 0);
  assert.equal(setup.updates.length, count);
  assert.equal(setup.timers.active.size, 0);
});

test('pair-success prevents later refresh notifications from replacing the completed session secret', async (t) => {
  const setup = await pairingHarness(t);
  await setup.socket.ws.receive(pairingRefs());
  await setup.socket.ws.receive({
    tag: 'iq',
    attrs: { id: 'fixture-pair-success' },
    content: [{ tag: 'pair-success', attrs: {} }],
  });
  assert.ok(setup.credentials.me);
  const originalSecret = setup.credentials.advSecretKey;
  const count = setup.updates.length;
  const credentialCount = setup.credentialUpdates.length;
  await setup.socket.ws.receive(refresh());
  assert.equal(setup.credentials.advSecretKey, originalSecret);
  assert.equal(setup.updates.length, count);
  assert.equal(setup.credentialUpdates.length, credentialCount);
});

test('a refresh before initial refs updates credentials without emitting an invalid QR', async (t) => {
  const setup = await pairingHarness(t);
  const oldSecret = setup.credentials.advSecretKey;
  await setup.socket.ws.receive(refresh());
  assert.notEqual(setup.credentials.advSecretKey, oldSecret);
  assert.equal(setup.updates.length, 0);
  assert.equal(setup.timers.active.size, 0);
  await setup.socket.ws.receive(pairingRefs());
  assert.equal(qrFields(setup.updates[0])[3], setup.credentials.advSecretKey);
});

async function acknowledgementHarness() {
  const socket = {
    ws: new FakeWebSocket(),
    ev: new FakeEvents(),
    authState: { creds: creds(), keys: {} },
    signalRepository: { lidMapping: { getLIDForPN() {} } },
    notificationMutex: { mutex: (callback: () => unknown) => callback() },
    registerSocketEndHandler() {},
    sendNode: async (node: FixtureNode): Promise<void> => {
      socket.ws.sent.push(node);
    },
  };
  const ack = await import(pathToFileURL(path.join(sdkRoot, 'lib/Utils/stanza-ack.js')).href);
  const namespace = await evaluateInstalledModule<AcknowledgementModule>(
    'lib/Socket/messages-recv.js',
    {
      '@cacheable/node-cache': { default: class {} },
      '../Defaults/index.js': { DEFAULT_CACHE_TTLS: { MSG_RETRY: 300, CALL_OFFER: 300 } },
      '../Types/index.js': { ReachoutTimelockEnforcementType: {} },
      '../Utils/make-mutex.js': {
        makeMutex: () => ({ mutex: (callback: () => unknown) => callback() }),
      },
      '../Utils/offline-node-processor.js': {
        makeOfflineNodeProcessor: () => ({
          enqueue() {
            throw new Error('Unexpected offline node');
          },
        }),
      },
      '../Utils/stanza-ack.js': { buildAckStanza: ack.buildAckStanza },
      '../Utils/tc-token-utils.js': { readTcTokenIndex: async () => [] },
      '../WABinary/index.js': {
        S_WHATSAPP_NET: '@s.whatsapp.net',
        getBinaryNodeChild: (node: FixtureNode, tag: string) => children(node, tag)[0],
      },
      './messages-send.js': { makeMessagesSocket: () => socket },
    }
  );
  return {
    socket: namespace.makeMessagesRecvSocket({ logger: logger(), shouldIgnoreJid: () => true }),
    sent: socket.ws.sent,
  };
}

test('the actual SDK ACK function acknowledges pre-login notifications without requiring creds.me', async () => {
  const setup = await acknowledgementHarness();
  await setup.socket.sendMessageAck(refresh());
  assert.equal(setup.sent.length, 1);
  assert.deepEqual(
    { ...setup.sent[0].attrs },
    {
      id: 'fixture-refresh-id',
      to: '@s.whatsapp.net',
      class: 'notification',
      type: 'companion_reg_refresh',
    }
  );
  assert.equal(setup.sent[0].tag, 'ack');
  assert.equal(Object.hasOwn(setup.sent[0].attrs, 'from'), false);
});

test('logged-in message ACKs retain the authenticated from attribute', async () => {
  const setup = await acknowledgementHarness();
  setup.socket.authState.creds.me = { id: 'fixture-device@s.whatsapp.net' };
  await setup.socket.sendMessageAck({
    tag: 'message',
    attrs: { id: 'fixture-message', from: 'fixture-peer@s.whatsapp.net', type: 'text' },
  });
  assert.equal(setup.sent[0].attrs.from, 'fixture-device@s.whatsapp.net');
  assert.equal(setup.sent[0].attrs.class, 'message');
});

test('the installed SDK imports without opening a provider connection', async () => {
  const sdk = await import(pathToFileURL(path.join(sdkRoot, 'lib/index.js')).href);
  assert.equal(typeof sdk.makeWASocket, 'function');
  assert.equal(typeof sdk.buildPairingQRData, 'function');
});
