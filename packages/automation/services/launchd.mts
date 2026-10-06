import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import * as fs from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, promisify } from 'node:util';

const execute = promisify(execFile);
const SERVICE_LABEL = 'com.stock-checker.whatsapp';
const DAILY_SERVICE_LABEL = 'com.stock-checker.daily-report';
const OWNER_VERSION = 1;
const COMMANDS = new Set(['install', 'start', 'restart', 'stop', 'status', 'uninstall']);
const TASKS = new Set(['whatsapp:gateway', 'whatsapp:link']);
const SERVICES = new Set(['whatsapp', 'daily-report']);
const SAFE_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

export type ServiceName = 'whatsapp' | 'daily-report';
export type ServiceCommand = 'install' | 'start' | 'restart' | 'stop' | 'status' | 'uninstall';
type ServiceTask = 'whatsapp:gateway' | 'whatsapp:link' | 'daily-report';

export interface ServiceRunOptions {
  cwd: string;
}

export type ServiceRunner = (
  program: string,
  arguments_: readonly string[],
  options: ServiceRunOptions
) => Promise<{ stdout: string; stderr: string }>;

export interface ServiceManagerOptions {
  service?: ServiceName;
  platform?: string;
  uid?: number;
  environment?: NodeJS.ProcessEnv;
  run?: ServiceRunner;
  fs?: Pick<
    typeof fs,
    | 'access'
    | 'chmod'
    | 'link'
    | 'lstat'
    | 'mkdir'
    | 'open'
    | 'readFile'
    | 'realpath'
    | 'rename'
    | 'stat'
    | 'unlink'
  >;
  projectRoot?: string;
  homeDirectory?: string;
  misePath?: string;
  asidePath?: string;
}

export type ServiceConfiguration = {
  Label: string;
  StockCheckerServiceVersion: number;
  StockCheckerProjectRoot: string;
  ProgramArguments: [string, '--quiet', 'run', ServiceTask];
  WorkingDirectory: string;
  EnvironmentVariables: { PATH: string; WHATSAPP_MANAGED_SERVICE?: string };
  RunAtLoad: boolean;
  KeepAlive: boolean;
  StartInterval?: number;
  ThrottleInterval: number;
  ExitTimeOut: number;
  ProcessType: string;
  AbandonProcessGroup: boolean;
  Umask: number;
  StandardOutPath: string;
  StandardErrorPath: string;
};

export interface ServiceStatus {
  service: ServiceName;
  label: string;
  installed: boolean;
  loaded: boolean;
  state: 'running' | 'waiting' | 'stopped' | 'not-installed';
  pairing?: boolean;
  timezone?: string;
  startWindow?: string;
  tickIntervalSeconds?: number;
  pid?: number;
  lastExitCode?: number;
}

interface ServiceContext {
  projectRoot: string;
  launchAgents: string;
  logsDirectory: string;
  plistPath: string;
  stdoutPath: string;
  stderrPath: string;
  domain: string;
  target: string;
}

interface OwnedConfiguration {
  configuration: ServiceConfiguration;
  stat: Stats;
}

interface LoadedService {
  origin: string | undefined;
  pid: number | undefined;
  lastExitCode: number | undefined;
}

export interface ServiceManager {
  install(options?: { link?: boolean }): Promise<ServiceStatus>;
  start(): Promise<ServiceStatus>;
  restart(): Promise<ServiceStatus>;
  stop(): Promise<ServiceStatus>;
  status(): Promise<ServiceStatus>;
  uninstall(): Promise<ServiceStatus>;
}

class ServiceError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'ServiceError';
    this.code = code;
  }
}

function xmlEscape(value: unknown): string {
  const text = String(value);
  if (
    Array.from(text).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 && code !== 9 && code !== 10 && code !== 13;
    })
  ) {
    throw new ServiceError('invalid-path');
  }
  return text.replace(
    /[<>&"']/g,
    (character) =>
      (
        ({
          '<': '&lt;',
          '>': '&gt;',
          '&': '&amp;',
          '"': '&quot;',
          "'": '&apos;',
        }) as Record<string, string>
      )[character]
  );
}

function renderPlist(configuration: Record<string, unknown>): string {
  function render(value: unknown, indentation: number): string {
    const space = '  '.repeat(indentation);
    if (typeof value === 'boolean') return `${space}<${value ? 'true' : 'false'}/>`;
    if (typeof value === 'number') return `${space}<integer>${value}</integer>`;
    if (typeof value === 'string') return `${space}<string>${xmlEscape(value)}</string>`;
    if (Array.isArray(value)) {
      return `${space}<array>\n${value.map((item) => render(item, indentation + 1)).join('\n')}\n${space}</array>`;
    }
    const entries = Object.entries(value as Record<string, unknown>)
      .map(
        ([key, item]) => `${space}  <key>${xmlEscape(key)}</key>\n${render(item, indentation + 1)}`
      )
      .join('\n');
    return `${space}<dict>\n${entries}\n${space}</dict>`;
  }
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
    `<plist version="1.0">\n${render(configuration, 0)}\n</plist>\n`
  );
}

function parseArguments(arguments_: readonly string[]): {
  command: ServiceCommand;
  service: ServiceName;
  link: boolean;
} {
  const [command, ...options] = arguments_;
  if (!command || !COMMANDS.has(command)) throw new ServiceError('invalid-command');
  let service: string | undefined;
  let link = false;
  for (const option of options) {
    if (option === '--link' && command === 'install' && !link) link = true;
    else if (SERVICES.has(option) && service === undefined) service = option;
    else throw new ServiceError('invalid-arguments');
  }
  service ??= 'whatsapp';
  if (service === 'daily-report' && link) throw new ServiceError('invalid-arguments');
  return { command: command as ServiceCommand, service: service as ServiceName, link };
}

const defaultRun: ServiceRunner = async (program, arguments_, options) => {
  return execute(program, [...arguments_], {
    ...options,
    timeout: 15_000,
    maxBuffer: 262_144,
    encoding: 'utf8',
  });
};

function createServiceManager(options: ServiceManagerOptions = {}): ServiceManager {
  const service = options.service ?? 'whatsapp';
  if (!SERVICES.has(service)) throw new ServiceError('invalid-arguments');
  const daily = service === 'daily-report';
  const label = daily ? DAILY_SERVICE_LABEL : SERVICE_LABEL;
  const tasks = daily ? new Set(['daily-report']) : TASKS;
  const platform = options.platform ?? process.platform;
  const uid = options.uid ?? process.getuid?.();
  const environment = options.environment ?? process.env;
  const run = options.run ?? defaultRun;
  const io = options.fs ?? fs;
  const requestedRoot = path.resolve(
    options.projectRoot ?? fileURLToPath(new URL('../../..', import.meta.url))
  );
  const homeDirectory = path.resolve(options.homeDirectory ?? homedir());
  let context: ServiceContext;

  async function initialize() {
    if (platform !== 'darwin') throw new ServiceError('macos-required');
    if (typeof uid !== 'number' || !Number.isSafeInteger(uid) || uid <= 0)
      throw new ServiceError('user-session-required');
    if (context) return context;
    const projectRoot = await io.realpath(requestedRoot);
    const launchAgents = path.join(homeDirectory, 'Library/LaunchAgents');
    const logsDirectory = path.join(projectRoot, 'data/services');
    context = {
      projectRoot,
      launchAgents,
      logsDirectory,
      plistPath: path.join(launchAgents, `${label}.plist`),
      stdoutPath: path.join(logsDirectory, `${service}.stdout.log`),
      stderrPath: path.join(logsDirectory, `${service}.stderr.log`),
      domain: `gui/${uid}`,
      target: `gui/${uid}/${label}`,
    };
    return context;
  }

  async function command(program: string, arguments_: readonly string[], failureCode: string) {
    try {
      return await run(program, arguments_, { cwd: context.projectRoot });
    } catch {
      throw new ServiceError(failureCode);
    }
  }

  async function statOrMissing(file: string): Promise<Stats | undefined> {
    try {
      return await io.lstat(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new ServiceError('filesystem-inspection-failed');
    }
  }

  async function ensureDirectory(directory: string, privateMode = false): Promise<void> {
    const parent = path.dirname(directory);
    if (parent !== directory) {
      const parentStat = await statOrMissing(parent);
      if (!parentStat) await ensureDirectory(parent);
      else if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
        throw new ServiceError('unsafe-directory');
      }
    }
    const existing = await statOrMissing(directory);
    if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) {
      throw new ServiceError('unsafe-directory');
    }
    if (!existing) await io.mkdir(directory, { mode: 0o700 });
    if (privateMode) await io.chmod(directory, 0o700);
  }

  async function ensurePrivateLog(file: string) {
    let handle: fs.FileHandle | undefined;
    try {
      handle = await io.open(
        file,
        constants.O_CREAT |
          constants.O_APPEND |
          constants.O_WRONLY |
          constants.O_NOFOLLOW |
          constants.O_NONBLOCK,
        0o600
      );
      const stat = await handle.stat();
      if (!stat.isFile() || stat.uid !== uid) throw new ServiceError('unsafe-log-file');
      await handle.chmod(0o600);
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError('unsafe-log-file');
    } finally {
      await handle?.close();
    }
  }

  async function prepareLocalFiles() {
    await ensureDirectory(context.launchAgents);
    await ensureDirectory(context.logsDirectory, true);
    await ensurePrivateLog(context.stdoutPath);
    await ensurePrivateLog(context.stderrPath);
  }

  async function readConfiguration(): Promise<OwnedConfiguration | undefined> {
    const stat = await statOrMissing(context.plistPath);
    if (!stat) return undefined;
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== uid || stat.size > 65_536) {
      throw new ServiceError('unmanaged-service');
    }
    const converted = await command(
      '/usr/bin/plutil',
      ['-convert', 'json', '-o', '-', '--', context.plistPath],
      'unmanaged-service'
    );
    let configuration: Partial<ServiceConfiguration> | null;
    try {
      configuration = JSON.parse(converted.stdout);
    } catch {
      throw new ServiceError('unmanaged-service');
    }
    const arguments_ = configuration?.ProgramArguments;
    if (
      configuration?.StockCheckerServiceVersion !== OWNER_VERSION ||
      configuration.StockCheckerProjectRoot !== context.projectRoot ||
      configuration.Label !== label ||
      configuration.WorkingDirectory !== context.projectRoot ||
      !Array.isArray(arguments_) ||
      arguments_.length !== 4 ||
      typeof arguments_[0] !== 'string' ||
      !path.isAbsolute(arguments_[0]) ||
      path.basename(arguments_[0]) !== 'mise' ||
      arguments_[1] !== '--quiet' ||
      arguments_[2] !== 'run' ||
      !tasks.has(arguments_[3]) ||
      configuration.StandardOutPath !== context.stdoutPath ||
      configuration.StandardErrorPath !== context.stderrPath
    ) {
      throw new ServiceError('unmanaged-service');
    }
    if (
      !isDeepStrictEqual(
        configuration,
        makeConfiguration(arguments_[0], arguments_[3] === 'whatsapp:link')
      )
    ) {
      throw new ServiceError('unmanaged-service');
    }
    return { configuration: configuration as ServiceConfiguration, stat };
  }

  async function inspectLoaded(): Promise<LoadedService | undefined> {
    let inspected: Awaited<ReturnType<ServiceRunner>>;
    try {
      inspected = await run('/bin/launchctl', ['print', context.target], {
        cwd: context.projectRoot,
      });
    } catch (error) {
      const failure = error as { code?: number; stderr?: string };
      if (
        (failure.code === 113 || failure.code === 3) &&
        /could not find service/i.test(failure.stderr ?? '')
      ) {
        return undefined;
      }
      throw new ServiceError('service-inspection-failed');
    }
    // launchctl's diagnostic format is not an API. Unknown origin fails closed;
    // optional process fields are best-effort and never expose raw output.
    const origin = inspected.stdout.match(/^\s*path = (.+)$/m)?.[1];
    const pidText = inspected.stdout.match(/^\s*pid = (\d+)$/m)?.[1];
    const exitText = inspected.stdout.match(/^\s*last exit code = (-?\d+)$/m)?.[1];
    return {
      origin,
      pid: pidText ? Number(pidText) : undefined,
      lastExitCode: exitText ? Number(exitText) : undefined,
    };
  }

  function assertOwned(owned: OwnedConfiguration | undefined, loaded: LoadedService | undefined) {
    if (loaded && (!owned || loaded.origin !== context.plistPath)) {
      throw new ServiceError('unmanaged-service');
    }
  }

  async function inspect() {
    await initialize();
    const owned = await readConfiguration();
    const loaded = await inspectLoaded();
    assertOwned(owned, loaded);
    return { owned, loaded };
  }

  async function findMise() {
    const explicit = options.misePath ?? environment.MISE_BIN;
    const candidates = explicit
      ? [explicit]
      : [
          ...(environment.PATH ?? '')
            .split(path.delimiter)
            .filter(path.isAbsolute)
            .map((directory) => path.join(directory, 'mise')),
          path.join(homeDirectory, '.local/bin/mise'),
          '/opt/homebrew/bin/mise',
          '/usr/local/bin/mise',
        ];
    for (const candidate of candidates) {
      if (!path.isAbsolute(candidate) || path.basename(candidate) !== 'mise') continue;
      try {
        const resolved = await io.realpath(candidate);
        if (!(await io.stat(resolved)).isFile()) continue;
        await io.access(resolved, constants.X_OK);
        // Preserve stable launchers (for example Homebrew's bin/mise symlink)
        // so installing a newer mise version does not invalidate the agent.
        return candidate;
      } catch {
        // Discovery is restricted to explicit executable paths; no shell runs.
      }
    }
    throw new ServiceError('mise-not-found');
  }

  async function checkReadiness(mise: string, task: ServiceTask) {
    let settings: string;
    try {
      settings = await io.readFile(path.join(context.projectRoot, 'mise.toml'), 'utf8');
      const entry = await io.stat(
        path.join(
          context.projectRoot,
          daily
            ? 'packages/core/src/commands/daily-report.ts'
            : 'packages/core/src/whatsapp/index.ts'
        )
      );
      if (!entry.isFile()) throw new Error('Missing entry');
    } catch {
      throw new ServiceError(daily ? 'daily-report-not-installed' : 'gateway-not-installed');
    }
    const taskSection = `[tasks."${task}"]`;
    if (!settings.split(/\r?\n/).some((line) => line.trim() === taskSection)) {
      throw new ServiceError(daily ? 'daily-report-task-missing' : 'gateway-task-missing');
    }
    const checked = await command(
      mise,
      ['--quiet', 'exec', '--', 'node', '--version'],
      'runtime-check-failed'
    );
    if (!/^v26\.\d+\.\d+(?:[-+][\w.-]+)?\s*$/.test(checked.stdout)) {
      throw new ServiceError('node-26-required');
    }
    if (daily) {
      const bun = await command(
        mise,
        ['--quiet', 'exec', '--', 'bun', '--version'],
        'runtime-check-failed'
      );
      if (!/^1\.\d+\.\d+(?:[-+][\w.-]+)?\s*$/.test(bun.stdout))
        throw new ServiceError('bun-required');
      const explicit = options.asidePath ?? environment.ASIDE_BIN;
      const candidates = explicit
        ? [explicit]
        : [
            path.join(homeDirectory, '.local/bin/aside'),
            ...(environment.PATH ?? '')
              .split(path.delimiter)
              .filter(path.isAbsolute)
              .map((directory) => path.join(directory, 'aside')),
          ];
      let available = false;
      for (const candidate of candidates) {
        if (!path.isAbsolute(candidate) || path.basename(candidate) !== 'aside') continue;
        try {
          const resolved = await io.realpath(candidate);
          if (!(await io.stat(resolved)).isFile()) continue;
          await io.access(resolved, constants.X_OK);
          available = true;
          break;
        } catch {
          /* Probe executable locations only; no browser navigation. */
        }
      }
      if (!available) throw new ServiceError('aside-not-found');
    }
  }

  function makeConfiguration(mise: string, link: boolean): ServiceConfiguration {
    if (daily && link) throw new ServiceError('invalid-arguments');
    return {
      Label: label,
      StockCheckerServiceVersion: OWNER_VERSION,
      StockCheckerProjectRoot: context.projectRoot,
      ProgramArguments: [
        mise,
        '--quiet',
        'run',
        daily ? 'daily-report' : link ? 'whatsapp:link' : 'whatsapp:gateway',
      ],
      WorkingDirectory: context.projectRoot,
      EnvironmentVariables: daily
        ? { PATH: SAFE_PATH }
        : { PATH: SAFE_PATH, WHATSAPP_MANAGED_SERVICE: '1' },
      RunAtLoad: true,
      KeepAlive: !daily,
      ...(daily ? { StartInterval: 60 } : {}),
      ThrottleInterval: 30,
      ExitTimeOut: 30,
      ProcessType: 'Background',
      AbandonProcessGroup: false,
      Umask: 63,
      StandardOutPath: context.stdoutPath,
      StandardErrorPath: context.stderrPath,
    };
  }

  async function writeConfiguration(
    configuration: ServiceConfiguration,
    previous: Stats | undefined,
    beforePublish?: () => Promise<void>
  ) {
    const temporary = path.join(context.launchAgents, `.${label}.${randomUUID()}.plist`);
    let handle: fs.FileHandle | undefined;
    try {
      handle = await io.open(temporary, 'wx', 0o600);
      await handle.writeFile(renderPlist(configuration), 'utf8');
      await handle.chmod(0o600);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await command('/usr/bin/plutil', ['-lint', '--', temporary], 'plist-validation-failed');
      const current = await statOrMissing(context.plistPath);
      if (
        previous
          ? !current || current.ino !== previous.ino || current.mtimeMs !== previous.mtimeMs
          : current
      ) {
        throw new ServiceError('service-configuration-changed');
      }
      await beforePublish?.();
      const latest = await statOrMissing(context.plistPath);
      if (
        previous
          ? !latest || latest.ino !== previous.ino || latest.mtimeMs !== previous.mtimeMs
          : latest
      ) {
        throw new ServiceError('service-configuration-changed');
      }
      if (previous) await io.rename(temporary, context.plistPath);
      else {
        await io.link(temporary, context.plistPath);
        await io.unlink(temporary);
      }
    } finally {
      await handle?.close();
      await io.unlink(temporary).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      });
    }
  }

  async function bootout() {
    await command('/bin/launchctl', ['bootout', context.target], 'service-stop-failed');
  }

  async function activate(loaded: LoadedService | undefined, restartRunning = false) {
    await command('/bin/launchctl', ['enable', context.target], 'service-enable-failed');
    if (!loaded) {
      await command(
        '/bin/launchctl',
        ['bootstrap', context.domain, context.plistPath],
        'service-start-failed'
      );
    }
    const arguments_ =
      loaded && restartRunning
        ? ['kickstart', '-k', context.target]
        : ['kickstart', context.target];
    await command('/bin/launchctl', arguments_, 'service-start-failed');
  }

  async function status(): Promise<ServiceStatus> {
    const { owned, loaded } = await inspect();
    return {
      service,
      label,
      installed: Boolean(owned),
      loaded: Boolean(loaded),
      state: loaded ? (loaded.pid ? 'running' : 'waiting') : owned ? 'stopped' : 'not-installed',
      ...(daily
        ? { timezone: 'Australia/Sydney', startWindow: '09:00–09:14', tickIntervalSeconds: 60 }
        : { pairing: owned?.configuration.ProgramArguments[3] === 'whatsapp:link' }),
      ...(loaded?.pid ? { pid: loaded.pid } : {}),
      ...(loaded?.lastExitCode !== undefined ? { lastExitCode: loaded.lastExitCode } : {}),
    };
  }

  async function install({ link = false } = {}) {
    const { owned, loaded } = await inspect();
    const mise = await findMise();
    const configuration = makeConfiguration(mise, link);
    await checkReadiness(mise, configuration.ProgramArguments[3]);
    await prepareLocalFiles();
    const changed = !owned || renderPlist(owned.configuration) !== renderPlist(configuration);
    if (changed) {
      await writeConfiguration(configuration, owned?.stat, loaded ? bootout : undefined);
    } else {
      await io.chmod(context.plistPath, 0o600);
    }
    await activate(changed ? undefined : loaded);
    return status();
  }

  async function startOwnedService(restartRunning: boolean) {
    const { owned, loaded } = await inspect();
    if (!owned) throw new ServiceError('service-not-installed');
    await checkReadiness(
      owned.configuration.ProgramArguments[0],
      owned.configuration.ProgramArguments[3]
    );
    await prepareLocalFiles();
    await activate(loaded, restartRunning);
    return status();
  }

  async function start() {
    return startOwnedService(false);
  }

  async function restart() {
    return startOwnedService(true);
  }

  async function stop() {
    const { owned, loaded } = await inspect();
    if (!owned) throw new ServiceError('service-not-installed');
    await command('/bin/launchctl', ['disable', context.target], 'service-disable-failed');
    if (loaded) await bootout();
    return status();
  }

  async function uninstall() {
    const { owned, loaded } = await inspect();
    if (!owned) return status();
    if (loaded) await bootout();
    const current = await statOrMissing(context.plistPath);
    if (!current || current.ino !== owned.stat.ino || current.mtimeMs !== owned.stat.mtimeMs) {
      throw new ServiceError('service-configuration-changed');
    }
    await io.unlink(context.plistPath);
    // Linked credentials, tokens, recipient configuration and logs are retained.
    return status();
  }

  return { install, start, restart, stop, status, uninstall };
}

async function main(
  arguments_: readonly string[] = process.argv.slice(2),
  options: ServiceManagerOptions = {}
): Promise<ServiceStatus> {
  const { command, service, link } = parseArguments(arguments_);
  const manager = createServiceManager({ ...options, service });
  return command === 'install' ? manager.install({ link }) : manager[command]();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    })
    .catch((error) => {
      const code = error instanceof ServiceError ? error.code : 'service-operation-failed';
      process.stderr.write(`${JSON.stringify({ error: code })}\n`);
      process.exitCode = 1;
    });
}

export {
  createServiceManager,
  DAILY_SERVICE_LABEL,
  main,
  parseArguments,
  renderPlist,
  SERVICE_LABEL,
  ServiceError,
};
