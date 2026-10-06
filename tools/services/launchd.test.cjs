'use strict';

const assert = require('node:assert/strict');
const { constants } = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const {
  DAILY_SERVICE_LABEL,
  SERVICE_LABEL,
  createServiceManager,
  main,
  parseArguments,
  renderPlist,
} = require('./launchd.cjs');

function decodeXml(text) {
  return text.replace(
    /&(lt|gt|amp|quot|apos);/g,
    (_, name) =>
      ({
        lt: '<',
        gt: '>',
        amp: '&',
        quot: '"',
        apos: "'",
      })[name]
  );
}

// Standalone fixture parser for plutil's mocked JSON conversion. The real
// installer always delegates validity checks and conversion to macOS plutil.
function parseFixturePlist(xml) {
  const tokens = xml
    .match(
      /<(?:dict|array|key|string|integer|true|false)\b[^>]*>|<\/(?:dict|array|key|string|integer)>|[^<>]+/g
    )
    .map((token) => token.trim())
    .filter(Boolean);
  let index = tokens.indexOf('<dict>');
  function value() {
    const token = tokens[index++];
    if (token === '<true/>') return true;
    if (token === '<false/>') return false;
    if (token === '<dict>') {
      const result = {};
      while (tokens[index] !== '</dict>') {
        assert.equal(tokens[index++], '<key>');
        const key = decodeXml(tokens[index++]);
        assert.equal(tokens[index++], '</key>');
        result[key] = value();
      }
      index++;
      return result;
    }
    if (token === '<array>') {
      const result = [];
      while (tokens[index] !== '</array>') result.push(value());
      index++;
      return result;
    }
    assert.ok(token === '<string>' || token === '<integer>');
    const content = tokens[index++];
    assert.equal(tokens[index++], token === '<string>' ? '</string>' : '</integer>');
    return token === '<string>' ? decodeXml(content) : Number(content);
  }
  return value();
}

async function fixture(t, overrides = {}) {
  const temporary = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'stock-checker-service-'))
  );
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const projectRoot = path.join(temporary, 'project & 한국 with spaces');
  const homeDirectory = path.join(temporary, 'home with spaces');
  const misePath = path.join(temporary, 'tools with spaces/mise');
  const uid = process.getuid?.() ?? 501;
  const label = overrides.service === 'daily-report' ? DAILY_SERVICE_LABEL : SERVICE_LABEL;
  const target = `gui/${uid}/${label}`;
  const plistPath = path.join(homeDirectory, 'Library/LaunchAgents', `${label}.plist`);
  const calls = [];
  const state = {
    loaded: false,
    disabled: false,
    origin: plistPath,
    pid: 9876,
    exitCode: 0,
    failures: new Map(),
  };
  await fs.mkdir(path.join(projectRoot, 'packages/core/src/whatsapp'), { recursive: true });
  await fs.mkdir(path.join(projectRoot, 'packages/core/src/commands'), { recursive: true });
  await fs.mkdir(homeDirectory, { recursive: true });
  await fs.mkdir(path.join(homeDirectory, '.local/bin'), { recursive: true });
  await fs.writeFile(path.join(homeDirectory, '.local/bin/aside'), '#!/bin/sh\nexit 0\n', {
    mode: 0o700,
  });
  await fs.mkdir(path.dirname(misePath), { recursive: true });
  await fs.writeFile(misePath, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  await fs.writeFile(
    path.join(projectRoot, 'mise.toml'),
    '[tasks."whatsapp:gateway"]\nrun="node gateway.ts"\n[tasks."whatsapp:link"]\nrun="node gateway.ts --link"\n[tasks."daily-report"]\nrun="bun daily-report.ts"\n'
  );
  await fs.writeFile(path.join(projectRoot, 'packages/core/src/whatsapp/index.ts'), 'export {};\n');
  await fs.writeFile(
    path.join(projectRoot, 'packages/core/src/commands/daily-report.ts'),
    'export {};\n'
  );

  async function run(program, arguments_, options) {
    calls.push({ program, arguments_: [...arguments_], options });
    const failure = state.failures.get(arguments_[0]);
    if (failure) throw failure;
    if (program === misePath && arguments_[1] === 'exec') {
      return { stdout: arguments_[3] === 'bun' ? '1.4.2\n' : 'v26.1.0\n', stderr: '' };
    }
    if (program === '/usr/bin/plutil') {
      if (arguments_[0] === '-lint') return { stdout: 'OK\n', stderr: '' };
      return {
        stdout: JSON.stringify(parseFixturePlist(await fs.readFile(arguments_.at(-1), 'utf8'))),
        stderr: '',
      };
    }
    assert.equal(program, '/bin/launchctl');
    const [command, argument] = arguments_;
    if (command === 'print') {
      assert.equal(argument, target);
      if (!state.loaded)
        throw Object.assign(new Error('missing'), {
          code: 113,
          stderr: 'Could not find service.\n',
        });
      return {
        stdout: `${target} = {\n\tpath = ${state.origin}\n\tstate = running\n\tpid = ${state.pid}\n\tlast exit code = ${state.exitCode}\n\tenvironment = { FIXTURE_SECRET = never-expose-this }\n}\n`,
        stderr: '',
      };
    }
    if (command === 'bootstrap') {
      assert.equal(argument, `gui/${uid}`);
      assert.equal(arguments_[2], plistPath);
      state.loaded = true;
      state.origin = plistPath;
    } else if (command === 'kickstart') {
      if (argument === '-k') {
        assert.equal(arguments_[2], target);
        assert.equal(arguments_.length, 3);
        state.pid++;
      } else {
        assert.equal(argument, target);
        assert.equal(arguments_.length, 2);
      }
    } else {
      assert.equal(argument, target);
      if (command === 'enable') state.disabled = false;
      else if (command === 'disable') state.disabled = true;
      else if (command === 'bootout') state.loaded = false;
      else assert.fail(`Unexpected launchctl subcommand: ${command}`);
    }
    return { stdout: '', stderr: '' };
  }
  const options = {
    platform: 'darwin',
    uid,
    homeDirectory,
    projectRoot,
    misePath,
    environment: {},
    run,
    ...overrides,
  };
  return {
    temporary,
    projectRoot,
    homeDirectory,
    misePath,
    plistPath,
    calls,
    state,
    options,
    manager: createServiceManager(options),
    readPlist: async () => parseFixturePlist(await fs.readFile(plistPath, 'utf8')),
  };
}

function lifecycleCalls(calls) {
  return calls
    .filter(({ program, arguments_ }) => program === '/bin/launchctl' && arguments_[0] !== 'print')
    .map(({ arguments_ }) => arguments_);
}

test('explicit restart is accepted as a managed lifecycle command', () => {
  assert.deepEqual(parseArguments(['restart', 'whatsapp']), {
    command: 'restart',
    service: 'whatsapp',
    link: false,
  });
});

test('CLI accepts owned service names and explicit WhatsApp install pairing', () => {
  assert.deepEqual(parseArguments(['install']), {
    command: 'install',
    service: 'whatsapp',
    link: false,
  });
  assert.deepEqual(parseArguments(['install', '--link', 'whatsapp']), {
    command: 'install',
    service: 'whatsapp',
    link: true,
  });
  assert.deepEqual(parseArguments(['install', 'whatsapp', '--link']), {
    command: 'install',
    service: 'whatsapp',
    link: true,
  });
  for (const arguments_ of [
    [],
    ['reload'],
    ['install', 'api'],
    ['status', '--link'],
    ['install', '--link', '--link'],
    ['start', 'whatsapp', 'whatsapp'],
    ['install', '--all'],
    ['restart', '--link'],
  ]) {
    assert.throws(() => parseArguments(arguments_), {
      code:
        arguments_.length === 0 || arguments_[0] === 'reload'
          ? 'invalid-command'
          : 'invalid-arguments',
    });
  }
});

test('daily-report CLI rejects pairing and duplicate service options', () => {
  assert.deepEqual(parseArguments(['install', 'daily-report']), {
    command: 'install',
    service: 'daily-report',
    link: false,
  });
  for (const arguments_ of [
    ['install', 'daily-report', '--link'],
    ['install', '--link', 'daily-report'],
    ['start', 'daily-report', 'daily-report'],
  ])
    assert.throws(() => parseArguments(arguments_), { code: 'invalid-arguments' });
});

test('daily report installs an independent one-minute trigger without gateway keepalive', async (t) => {
  const setup = await fixture(t, { service: 'daily-report' });
  const status = await setup.manager.install();
  assert.equal(status.service, 'daily-report');
  assert.equal(status.label, 'com.stock-checker.daily-report');
  assert.equal(status.pairing, undefined);
  assert.equal(status.timezone, 'Australia/Sydney');
  assert.equal(status.startWindow, '09:00–09:14');
  const configuration = await setup.readPlist();
  assert.deepEqual(configuration.ProgramArguments, [
    setup.misePath,
    '--quiet',
    'run',
    'daily-report',
  ]);
  assert.equal(configuration.KeepAlive, false);
  assert.equal(configuration.StartInterval, 60);
  assert.equal(configuration.StartCalendarInterval, undefined);
  assert.equal(configuration.RunAtLoad, true);
  assert.deepEqual(configuration.EnvironmentVariables, { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' });
  assert.match(configuration.StandardOutPath, /daily-report\.stdout\.log$/);
  assert.equal((await fs.stat(setup.plistPath)).mode & 0o777, 0o600);
  assert.ok(
    setup.calls.some(({ arguments_ }) => arguments_.join(' ') === '--quiet exec -- bun --version')
  );
  assert.deepEqual(await main(['status', 'daily-report'], setup.options), status);
});

test('daily stop/start/uninstall only controls its own label and preserves gateway files', async (t) => {
  const setup = await fixture(t, { service: 'daily-report' });
  await setup.manager.install();
  const gatewayPlist = path.join(
    setup.homeDirectory,
    'Library/LaunchAgents',
    `${SERVICE_LABEL}.plist`
  );
  await fs.writeFile(gatewayPlist, 'gateway is separately owned');
  setup.calls.length = 0;
  await setup.manager.stop();
  assert.equal(setup.state.disabled, true);
  await setup.manager.start();
  assert.equal(setup.state.disabled, false);
  await setup.manager.uninstall();
  assert.equal(await fs.readFile(gatewayPlist, 'utf8'), 'gateway is separately owned');
  for (const arguments_ of lifecycleCalls(setup.calls)) {
    assert.ok(!arguments_.some((argument) => argument.includes(SERVICE_LABEL)));
  }
});

test('daily configuration refuses an altered schedule or gateway task', async (t) => {
  for (const mutation of [
    (configuration) => {
      configuration.StartInterval = 1;
    },
    (configuration) => {
      configuration.ProgramArguments[3] = 'whatsapp:gateway';
    },
  ]) {
    const setup = await fixture(t, { service: 'daily-report' });
    await setup.manager.install();
    const configuration = await setup.readPlist();
    mutation(configuration);
    await fs.writeFile(setup.plistPath, renderPlist(configuration));
    setup.calls.length = 0;
    await assert.rejects(setup.manager.start(), { code: 'unmanaged-service' });
    assert.deepEqual(lifecycleCalls(setup.calls), []);
  }
});

test('daily missing runner fails readiness before any launchctl mutation', async (t) => {
  const setup = await fixture(t, { service: 'daily-report' });
  await fs.unlink(path.join(setup.projectRoot, 'packages/core/src/commands/daily-report.ts'));
  await assert.rejects(setup.manager.install(), { code: 'daily-report-not-installed' });
  assert.deepEqual(lifecycleCalls(setup.calls), []);
});

test('daily readiness refuses a missing Aside executable without opening the browser', async (t) => {
  const setup = await fixture(t, { service: 'daily-report' });
  await fs.unlink(path.join(setup.homeDirectory, '.local/bin/aside'));
  await assert.rejects(setup.manager.install(), { code: 'aside-not-found' });
  assert.deepEqual(lifecycleCalls(setup.calls), []);
  assert.ok(!setup.calls.some(({ program }) => path.basename(program) === 'aside'));
});

test('plist XML preserves spaces, non-ASCII and metacharacters without shell interpretation', () => {
  const values = {
    Label: SERVICE_LABEL,
    ProgramArguments: ['/tmp/a & b/"mise"', "$(touch /tmp/nope) <'>"],
    Count: 30,
    KeepAlive: true,
  };
  const xml = renderPlist(values);
  assert.match(xml, /&amp;/);
  assert.match(xml, /&quot;/);
  assert.match(xml, /&apos;/);
  assert.deepEqual(parseFixturePlist(xml), values);
  assert.throws(() => renderPlist({ Path: '/tmp/\u0000bad' }), { code: 'invalid-path' });
});

test('non-macOS and root sessions fail before filesystem or subprocess mutations', async () => {
  for (const options of [
    { platform: 'linux', uid: 501 },
    { platform: 'darwin', uid: 0 },
  ]) {
    const calls = [];
    await assert.rejects(
      createServiceManager({
        ...options,
        run: (...arguments_) => calls.push(arguments_),
      }).install(),
      { code: options.platform === 'linux' ? 'macos-required' : 'user-session-required' }
    );
    assert.deepEqual(calls, []);
  }
});

test('install validates before bootstrap and writes private login/crash-restart configuration', async (t) => {
  const setup = await fixture(t);
  const status = await setup.manager.install();
  assert.equal(status.state, 'running');
  assert.equal(status.pairing, false);
  const configuration = await setup.readPlist();
  assert.deepEqual(configuration.ProgramArguments, [
    setup.misePath,
    '--quiet',
    'run',
    'whatsapp:gateway',
  ]);
  assert.equal(configuration.WorkingDirectory, setup.projectRoot);
  assert.equal(configuration.KeepAlive, true);
  assert.equal(configuration.RunAtLoad, true);
  assert.equal(configuration.ThrottleInterval, 30);
  assert.equal(configuration.Umask, 63);
  assert.deepEqual(configuration.EnvironmentVariables, {
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    WHATSAPP_MANAGED_SERVICE: '1',
  });
  assert.equal(configuration.AbandonProcessGroup, false);
  const lintIndex = setup.calls.findIndex(({ arguments_ }) => arguments_[0] === '-lint');
  const bootstrapIndex = setup.calls.findIndex(({ arguments_ }) => arguments_[0] === 'bootstrap');
  assert.ok(lintIndex >= 0 && lintIndex < bootstrapIndex);
  assert.equal((await fs.stat(setup.plistPath)).mode & 0o777, 0o600);
  assert.equal((await fs.stat(path.join(setup.projectRoot, 'data/services'))).mode & 0o777, 0o700);
  assert.equal((await fs.stat(configuration.StandardOutPath)).mode & 0o777, 0o600);
  assert.equal((await fs.stat(configuration.StandardErrorPath)).mode & 0o777, 0o600);
  assert.ok(setup.calls.every(({ options }) => options.cwd === setup.projectRoot));
  assert.deepEqual(
    lifecycleCalls(setup.calls).map((call) => call[0]),
    ['enable', 'bootstrap', 'kickstart']
  );
});

test('idempotent install preserves an already running process and plist inode', async (t) => {
  const setup = await fixture(t);
  await setup.manager.install();
  const previous = await fs.stat(setup.plistPath);
  setup.calls.length = 0;
  await setup.manager.install();
  assert.equal((await fs.stat(setup.plistPath)).ino, previous.ino);
  assert.deepEqual(
    lifecycleCalls(setup.calls).map((call) => call[0]),
    ['enable', 'kickstart']
  );
  assert.ok(!setup.calls.some(({ arguments_ }) => arguments_.includes('-k')));
});

test('explicit link installation can be replaced with normal gateway while preserving credentials', async (t) => {
  const setup = await fixture(t);
  await fs.mkdir(path.join(setup.projectRoot, 'data/whatsapp'), { recursive: true });
  const credentials = path.join(setup.projectRoot, 'data/whatsapp/creds.json');
  await fs.writeFile(credentials, 'private-session-fixture', { mode: 0o600 });
  assert.equal((await setup.manager.install({ link: true })).pairing, true);
  assert.equal((await setup.readPlist()).ProgramArguments[3], 'whatsapp:link');
  setup.calls.length = 0;
  assert.equal((await setup.manager.install()).pairing, false);
  assert.deepEqual(
    lifecycleCalls(setup.calls).map((call) => call[0]),
    ['bootout', 'enable', 'bootstrap', 'kickstart']
  );
  assert.equal(await fs.readFile(credentials, 'utf8'), 'private-session-fixture');
});

test('a failed mode-switch bootout preserves the original definition and remains retryable', async (t) => {
  const setup = await fixture(t);
  await setup.manager.install({ link: true });
  setup.state.failures.set('bootout', new Error('failure'));
  await assert.rejects(setup.manager.install(), { code: 'service-stop-failed' });
  assert.equal((await setup.readPlist()).ProgramArguments[3], 'whatsapp:link');
  assert.equal(setup.state.loaded, true);
  assert.ok(
    (await fs.readdir(path.dirname(setup.plistPath))).every((name) => !name.startsWith('.'))
  );
  setup.state.failures.delete('bootout');
  setup.calls.length = 0;
  assert.equal((await setup.manager.install()).pairing, false);
  assert.deepEqual(
    lifecycleCalls(setup.calls).map((call) => call[0]),
    ['bootout', 'enable', 'bootstrap', 'kickstart']
  );
});

test('stop remains disabled across login; start enables and bootstraps the exact owned job', async (t) => {
  const setup = await fixture(t);
  await setup.manager.install({ link: true });
  setup.calls.length = 0;
  assert.equal((await setup.manager.stop()).state, 'stopped');
  assert.equal(setup.state.disabled, true);
  assert.deepEqual(
    lifecycleCalls(setup.calls).map((call) => call[0]),
    ['disable', 'bootout']
  );
  setup.calls.length = 0;
  assert.equal((await setup.manager.start()).state, 'running');
  assert.equal(setup.state.disabled, false);
  assert.deepEqual(
    lifecycleCalls(setup.calls).map((call) => call[0]),
    ['enable', 'bootstrap', 'kickstart']
  );
  assert.equal((await setup.readPlist()).ProgramArguments[3], 'whatsapp:link');
});

test('stopping twice avoids a nonexistent bootout and leaves the managed definition', async (t) => {
  const setup = await fixture(t);
  await setup.manager.install();
  await setup.manager.stop();
  setup.calls.length = 0;
  await setup.manager.stop();
  assert.deepEqual(
    lifecycleCalls(setup.calls).map((call) => call[0]),
    ['disable']
  );
  assert.equal((await setup.manager.status()).installed, true);
});

test('restart targets the existing process while preserving pairing mode and private configuration', async (t) => {
  for (const link of [false, true]) {
    const setup = await fixture(t);
    await setup.manager.install({ link });
    const originalConfiguration = await setup.readPlist();
    const originalInode = (await fs.stat(setup.plistPath)).ino;
    const files = [
      path.join(setup.projectRoot, 'data/whatsapp/creds.json'),
      path.join(setup.projectRoot, 'data/whatsapp/gateway-token'),
      path.join(setup.projectRoot, '.env.whatsapp.local'),
    ];
    await fs.mkdir(path.dirname(files[0]), { recursive: true });
    for (const file of files)
      await fs.writeFile(file, 'private-fixture-preserved', { mode: 0o600 });
    setup.calls.length = 0;
    const originalPid = setup.state.pid;
    const result = await main(['restart', 'whatsapp'], setup.options);
    const target = `gui/${setup.options.uid}/${SERVICE_LABEL}`;
    assert.deepEqual(lifecycleCalls(setup.calls), [
      ['enable', target],
      ['kickstart', '-k', target],
    ]);
    assert.equal(result.pid, originalPid + 1);
    assert.equal(result.pairing, link);
    assert.equal((await fs.stat(setup.plistPath)).ino, originalInode);
    assert.deepEqual(await setup.readPlist(), originalConfiguration);
    for (const file of files)
      assert.equal(await fs.readFile(file, 'utf8'), 'private-fixture-preserved');
  }
});

test('restart enables and starts a stopped service without killing the newly bootstrapped process', async (t) => {
  const setup = await fixture(t);
  await setup.manager.install({ link: true });
  await setup.manager.stop();
  assert.equal(setup.state.disabled, true);
  setup.calls.length = 0;
  const originalPid = setup.state.pid;
  const result = await setup.manager.restart();
  const target = `gui/${setup.options.uid}/${SERVICE_LABEL}`;
  assert.deepEqual(lifecycleCalls(setup.calls), [
    ['enable', target],
    ['bootstrap', `gui/${setup.options.uid}`, setup.plistPath],
    ['kickstart', target],
  ]);
  assert.equal(result.state, 'running');
  assert.equal(result.pairing, true);
  assert.equal(result.pid, originalPid);
  assert.equal(setup.state.disabled, false);
});

test('restart fails before process mutation if runtime readiness has changed', async (t) => {
  const setup = await fixture(t);
  await setup.manager.install();
  const manager = createServiceManager({
    ...setup.options,
    run: async (program, arguments_, options) => {
      if (program === setup.misePath) return { stdout: 'v25.9.0\n', stderr: '' };
      return setup.options.run(program, arguments_, options);
    },
  });
  setup.calls.length = 0;
  await assert.rejects(manager.restart(), { code: 'node-26-required' });
  assert.deepEqual(lifecycleCalls(setup.calls), []);
});

test('start revalidates private log paths before enabling the stopped service', async (t) => {
  const setup = await fixture(t);
  await setup.manager.install();
  await setup.manager.stop();
  const configuration = await setup.readPlist();
  await fs.unlink(configuration.StandardOutPath);
  const protectedFile = path.join(setup.temporary, 'protected-after-stop');
  await fs.writeFile(protectedFile, 'untouched', { mode: 0o600 });
  await fs.symlink(protectedFile, configuration.StandardOutPath);
  setup.calls.length = 0;
  await assert.rejects(setup.manager.start(), { code: 'unsafe-log-file' });
  await assert.rejects(setup.manager.restart(), { code: 'unsafe-log-file' });
  assert.equal(await fs.readFile(protectedFile, 'utf8'), 'untouched');
  assert.deepEqual(lifecycleCalls(setup.calls), []);
  assert.equal(setup.state.disabled, true);
});

test('uninstall removes only the owned agent and retains session, token, configuration and logs', async (t) => {
  const setup = await fixture(t);
  await setup.manager.install();
  const files = [
    path.join(setup.projectRoot, 'data/whatsapp/creds.json'),
    path.join(setup.projectRoot, 'data/whatsapp/gateway-token'),
    path.join(setup.projectRoot, '.env.whatsapp.local'),
  ];
  await fs.mkdir(path.dirname(files[0]), { recursive: true });
  for (const file of files) await fs.writeFile(file, 'preserved', { mode: 0o600 });
  const configuration = await setup.readPlist();
  setup.calls.length = 0;
  const result = await setup.manager.uninstall();
  assert.equal(result.state, 'not-installed');
  assert.deepEqual(
    lifecycleCalls(setup.calls).map((call) => call[0]),
    ['bootout']
  );
  await assert.rejects(fs.stat(setup.plistPath), { code: 'ENOENT' });
  for (const file of [...files, configuration.StandardOutPath, configuration.StandardErrorPath]) {
    await fs.access(file);
  }
  assert.equal((await setup.manager.uninstall()).installed, false);
});

test('status emits safe process fields and never raw launchctl environment', async (t) => {
  const setup = await fixture(t);
  assert.equal((await setup.manager.status()).state, 'not-installed');
  await setup.manager.install();
  setup.state.exitCode = -15;
  const result = await setup.manager.status();
  assert.equal(result.pid, 9876);
  assert.equal(result.lastExitCode, -15);
  assert.doesNotMatch(JSON.stringify(result), /never-expose|environment|project &/);
  setup.state.pid = 0;
  assert.equal((await setup.manager.status()).state, 'waiting');
});

test('a foreign installed agent is rejected without replacement or lifecycle commands', async (t) => {
  const setup = await fixture(t);
  await fs.mkdir(path.dirname(setup.plistPath), { recursive: true });
  const foreign = renderPlist({ Label: SERVICE_LABEL, WorkingDirectory: '/another/repository' });
  await fs.writeFile(setup.plistPath, foreign, { mode: 0o600 });
  for (const command of ['install', 'start', 'restart', 'stop', 'status', 'uninstall']) {
    await assert.rejects(setup.manager[command](), { code: 'unmanaged-service' });
  }
  assert.equal(await fs.readFile(setup.plistPath, 'utf8'), foreign);
  assert.deepEqual(lifecycleCalls(setup.calls), []);
});

test('owned markers cannot authorize an arbitrary executable, environment or unsafe launch setting', async (t) => {
  const setup = await fixture(t);
  await setup.manager.install();
  const configuration = await setup.readPlist();
  const variants = [
    { ...configuration, ProgramArguments: ['/bin/sh', '--quiet', 'run', 'whatsapp:gateway'] },
    {
      ...configuration,
      EnvironmentVariables: {
        ...configuration.EnvironmentVariables,
        PRIVATE_KEY: 'fixture-secret',
      },
    },
    {
      ...configuration,
      EnvironmentVariables: { PATH: '/unsafe/bin', WHATSAPP_MANAGED_SERVICE: '1' },
    },
    { ...configuration, KeepAlive: false },
    { ...configuration, Program: '/bin/sh' },
    { ...configuration, AbandonProcessGroup: true },
  ];
  setup.calls.length = 0;
  for (const variant of variants) {
    await fs.writeFile(setup.plistPath, renderPlist(variant), { mode: 0o600 });
    for (const command of ['install', 'start', 'restart', 'stop', 'uninstall']) {
      await assert.rejects(setup.manager[command](), { code: 'unmanaged-service' });
    }
  }
  assert.deepEqual(lifecycleCalls(setup.calls), []);
});

test('another repository with the same service label cannot mutate this installation', async (t) => {
  const setup = await fixture(t);
  await setup.manager.install();
  const otherRoot = path.join(setup.temporary, 'another project');
  await fs.mkdir(otherRoot);
  const other = createServiceManager({ ...setup.options, projectRoot: otherRoot });
  setup.calls.length = 0;
  await assert.rejects(other.install(), { code: 'unmanaged-service' });
  assert.deepEqual(lifecycleCalls(setup.calls), []);
});

test('loaded foreign or unknown-origin jobs cannot be stopped even with a matching local plist', async (t) => {
  const setup = await fixture(t);
  await setup.manager.install();
  setup.calls.length = 0;
  for (const origin of ['/somewhere/foreign.plist', 'unknown']) {
    setup.state.origin = origin;
    for (const command of ['install', 'start', 'restart', 'stop', 'uninstall']) {
      await assert.rejects(setup.manager[command](), { code: 'unmanaged-service' });
    }
  }
  assert.deepEqual(lifecycleCalls(setup.calls), []);
});

test('a loaded job without its managed plist is never adopted', async (t) => {
  const setup = await fixture(t);
  setup.state.loaded = true;
  await assert.rejects(setup.manager.install(), { code: 'unmanaged-service' });
  assert.deepEqual(lifecycleCalls(setup.calls), []);
});

test('symlinked plist, log and service directories are refused without touching targets', async (t) => {
  for (const kind of ['plist', 'log', 'directory']) {
    const setup = await fixture(t);
    const protectedFile = path.join(setup.temporary, `protected-${kind}`);
    await fs.writeFile(protectedFile, 'untouched', { mode: 0o600 });
    let destination;
    if (kind === 'plist') {
      await fs.mkdir(path.dirname(setup.plistPath), { recursive: true });
      destination = setup.plistPath;
    } else {
      await fs.mkdir(path.join(setup.projectRoot, 'data/services'), { recursive: true });
      destination =
        kind === 'log'
          ? path.join(setup.projectRoot, 'data/services/whatsapp.stdout.log')
          : path.join(setup.projectRoot, 'data/services');
      if (kind === 'directory') await fs.rmdir(destination);
    }
    await fs.symlink(protectedFile, destination);
    await assert.rejects(setup.manager.install(), {
      code:
        kind === 'plist'
          ? 'unmanaged-service'
          : kind === 'log'
            ? 'unsafe-log-file'
            : 'unsafe-directory',
    });
    assert.equal(await fs.readFile(protectedFile, 'utf8'), 'untouched');
    assert.deepEqual(lifecycleCalls(setup.calls), []);
  }
});

test('nonregular log files fail before launchctl without opening a blocking FIFO', async (t) => {
  const setup = await fixture(t);
  await fs.mkdir(path.join(setup.projectRoot, 'data/services/whatsapp.stdout.log'), {
    recursive: true,
  });
  await assert.rejects(setup.manager.install(), { code: 'unsafe-log-file' });
  assert.deepEqual(lifecycleCalls(setup.calls), []);
  assert.ok(constants.O_NONBLOCK);
});

test('invalid plist lint stops installation and cleans its temporary private file', async (t) => {
  const setup = await fixture(t);
  setup.state.failures.set('-lint', new Error('Secret fixture diagnostic must stay private'));
  await assert.rejects(setup.manager.install(), { code: 'plist-validation-failed' });
  assert.deepEqual(lifecycleCalls(setup.calls), []);
  assert.deepEqual(await fs.readdir(path.dirname(setup.plistPath)), []);
});

test('runtime mismatch, missing task and missing executable fail without service mutation', async (t) => {
  const setup = await fixture(t);
  const mismatch = createServiceManager({
    ...setup.options,
    run: async (program, arguments_, options) => {
      if (program === setup.misePath) return { stdout: 'v25.9.0\n', stderr: '' };
      return setup.options.run(program, arguments_, options);
    },
  });
  await assert.rejects(mismatch.install(), { code: 'node-26-required' });
  await fs.writeFile(path.join(setup.projectRoot, 'mise.toml'), '[tasks.predict]\nrun="true"\n');
  await assert.rejects(setup.manager.install(), { code: 'gateway-task-missing' });
  const missing = createServiceManager({ ...setup.options, misePath: '/nonexistent/mise' });
  await assert.rejects(missing.install(), { code: 'mise-not-found' });
  assert.deepEqual(lifecycleCalls(setup.calls), []);
});

test('mise is discovered from an absolute PATH entry and resolved without a shell', async (t) => {
  const setup = await fixture(t);
  const discovered = createServiceManager({
    ...setup.options,
    misePath: undefined,
    environment: { PATH: `relative:${path.dirname(setup.misePath)}` },
  });
  await discovered.install();
  assert.equal((await setup.readPlist()).ProgramArguments[0], setup.misePath);
  assert.ok(setup.calls.every(({ program }) => !program.endsWith('/sh')));
});

test('a stable mise launcher survives a package-manager version symlink replacement', async (t) => {
  const setup = await fixture(t);
  const versions = [
    path.join(setup.temporary, 'Cellar/mise/version one/bin/mise'),
    path.join(setup.temporary, 'Cellar/mise/version two/bin/mise'),
  ];
  for (const executable of versions) {
    await fs.mkdir(path.dirname(executable), { recursive: true });
    await fs.writeFile(executable, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  }
  await fs.unlink(setup.misePath);
  await fs.symlink(versions[0], setup.misePath);
  const resolvedExecutables = [];
  const manager = createServiceManager({
    ...setup.options,
    misePath: undefined,
    environment: { MISE_BIN: setup.misePath },
    run: async (program, arguments_, options) => {
      if (program === setup.misePath) {
        await fs.access(program, constants.X_OK);
        resolvedExecutables.push(await fs.realpath(program));
      }
      return setup.options.run(program, arguments_, options);
    },
  });
  await manager.install();
  assert.equal((await setup.readPlist()).ProgramArguments[0], setup.misePath);
  await manager.stop();
  await fs.unlink(setup.misePath);
  await fs.symlink(versions[1], setup.misePath);
  await fs.rm(path.dirname(versions[0]), { recursive: true });
  assert.equal((await manager.start()).state, 'running');
  assert.deepEqual(resolvedExecutables, versions);
  assert.equal((await setup.readPlist()).ProgramArguments[0], setup.misePath);
});

test('explicit mise launchers must have an absolute path and the expected executable name', async (t) => {
  const setup = await fixture(t);
  const unrelated = path.join(setup.temporary, 'unrelated-executable');
  await fs.writeFile(unrelated, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  for (const misePath of ['relative/mise', unrelated]) {
    await assert.rejects(createServiceManager({ ...setup.options, misePath }).install(), {
      code: 'mise-not-found',
    });
  }
  assert.deepEqual(lifecycleCalls(setup.calls), []);
});

test('unexpected launchctl inspection errors fail closed and never expose raw errors', async (t) => {
  const setup = await fixture(t);
  setup.state.failures.set(
    'print',
    Object.assign(new Error('private error'), { code: 1, stderr: 'PRIVATE_TOKEN=fixture-secret' })
  );
  await assert.rejects(setup.manager.install(), (error) => {
    assert.equal(error.code, 'service-inspection-failed');
    assert.doesNotMatch(error.message, /PRIVATE_TOKEN|fixture-secret/);
    return true;
  });
  assert.deepEqual(lifecycleCalls(setup.calls), []);
});

test('start and stop require an installed managed agent', async (t) => {
  const setup = await fixture(t);
  await assert.rejects(setup.manager.start(), { code: 'service-not-installed' });
  await assert.rejects(setup.manager.restart(), { code: 'service-not-installed' });
  await assert.rejects(setup.manager.stop(), { code: 'service-not-installed' });
  assert.deepEqual(lifecycleCalls(setup.calls), []);
});

test('main delegates only the requested lifecycle action and returns a safe result', async (t) => {
  const setup = await fixture(t);
  const result = await main(['install', 'whatsapp', '--link'], setup.options);
  assert.equal(result.pairing, true);
  assert.equal(result.label, SERVICE_LABEL);
});
