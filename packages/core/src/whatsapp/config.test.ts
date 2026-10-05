import { execFile } from 'node:child_process';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensureGatewayToken,
  gatewayTokenPath,
  getWhatsAppGatewayConfiguration,
  readGatewayToken,
  resolveWhatsAppAuthDir,
} from './config.ts';

let directory: string;
let authDirectory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'stock-checker-gateway-config-'));
  authDirectory = join(directory, 'whatsapp');
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});

describe('WhatsApp gateway configuration', () => {
  it('resolves a relative authentication override from the project root for gateway and CLI callers', () => {
    const projectRoot = resolve(resolveWhatsAppAuthDir({}), '../..');
    const environment = { WHATSAPP_AUTH_DIR: 'data/custom-whatsapp' };
    const workingDirectory = vi.spyOn(process, 'cwd');
    workingDirectory.mockReturnValue(projectRoot);
    const fromGateway = resolveWhatsAppAuthDir(environment);
    workingDirectory.mockReturnValue(join(projectRoot, 'packages/core'));
    expect(resolveWhatsAppAuthDir(environment)).toBe(fromGateway);
    expect(fromGateway).toBe(join(projectRoot, 'data/custom-whatsapp'));
  });

  it('uses a repository-relative authentication directory independently of the invoking directory', () => {
    const expected = resolveWhatsAppAuthDir({});
    vi.spyOn(process, 'cwd').mockReturnValue(join(directory, 'other-working-directory'));
    expect(resolveWhatsAppAuthDir({})).toBe(expected);
    expect(expected.replaceAll('\\', '/')).toMatch(/\/data\/whatsapp\/$/);
    expect(getWhatsAppGatewayConfiguration({})).toEqual({ authDirectory: expected, port: 5102 });
  });

  it('supports an explicit authentication directory and port', () => {
    expect(
      getWhatsAppGatewayConfiguration({
        WHATSAPP_AUTH_DIR: authDirectory,
        WHATSAPP_GATEWAY_PORT: '5202',
      })
    ).toEqual({ authDirectory, port: 5202 });
    expect(gatewayTokenPath(authDirectory)).toBe(join(authDirectory, 'gateway-token'));
  });

  it.each(['0', '65536', '-1', '1.5', '5e3', 'not-a-port'])(
    'rejects an invalid port %s',
    (port) => {
      expect(() => getWhatsAppGatewayConfiguration({ WHATSAPP_GATEWAY_PORT: port })).toThrow(
        'Invalid WhatsApp gateway port'
      );
    }
  );

  it('reads absent configuration without creating authentication files', async () => {
    expect(await readGatewayToken(authDirectory, '')).toBeUndefined();
    expect(await readdir(directory)).toEqual([]);
  });

  it('prefers an environment token without touching the filesystem', async () => {
    const token = 'a'.repeat(64);
    expect(await readGatewayToken(authDirectory, token)).toBe(token);
    expect(await ensureGatewayToken(authDirectory, token)).toBe(token);
    expect(await readdir(directory)).toEqual([]);
  });

  it.each(['short', ' '.repeat(64), `a${'b'.repeat(63)}\n`, 'x'.repeat(513)])(
    'rejects malformed environment tokens without leaking them',
    async (token) => {
      await expect(readGatewayToken(authDirectory, token)).rejects.toThrow(
        'Invalid WhatsApp gateway token'
      );
      expect(await readdir(directory)).toEqual([]);
    }
  );

  it('creates one private random token and reuses it across concurrent starts and readers', async () => {
    const tokens = await Promise.all(
      Array.from({ length: 5 }, () => ensureGatewayToken(authDirectory, ''))
    );
    expect(new Set(tokens).size).toBe(1);
    expect(tokens[0]).toMatch(/^[a-f\d]{64}$/);
    expect((await lstat(authDirectory)).mode & 0o777).toBe(0o700);
    expect((await lstat(gatewayTokenPath(authDirectory))).mode & 0o777).toBe(0o600);
    expect(await readGatewayToken(authDirectory, '')).toBe(tokens[0]);
    expect(await readFile(gatewayTokenPath(authDirectory), 'utf8')).toBe(`${tokens[0]}\n`);
    expect(await readdir(authDirectory)).toEqual(['gateway-token']);
  });

  it('rejects a public token file and does not replace its existing token', async () => {
    await mkdir(authDirectory, { mode: 0o700 });
    await writeFile(gatewayTokenPath(authDirectory), 'a'.repeat(64), { mode: 0o600 });
    await chmod(gatewayTokenPath(authDirectory), 0o644);
    await expect(readGatewayToken(authDirectory, '')).rejects.toThrow(
      'Invalid WhatsApp gateway token file'
    );
    await expect(ensureGatewayToken(authDirectory, '')).rejects.toThrow(
      'Invalid WhatsApp gateway token file'
    );
    expect(await readFile(gatewayTokenPath(authDirectory), 'utf8')).toBe('a'.repeat(64));
  });

  it.each(['short', 'x'.repeat(514)])('rejects an invalid token file', async (contents) => {
    await mkdir(authDirectory, { mode: 0o700 });
    await writeFile(gatewayTokenPath(authDirectory), contents, { mode: 0o600 });
    await expect(readGatewayToken(authDirectory, '')).rejects.toThrow(
      'Invalid WhatsApp gateway token file'
    );
  });

  it('refuses a symlinked token file', async () => {
    await mkdir(authDirectory, { mode: 0o700 });
    const otherToken = join(directory, 'other-token');
    await writeFile(otherToken, 'a'.repeat(64), { mode: 0o600 });
    await symlink(otherToken, gatewayTokenPath(authDirectory));
    await expect(readGatewayToken(authDirectory, '')).rejects.toThrow(
      'Cannot read WhatsApp gateway token'
    );
    await expect(ensureGatewayToken(authDirectory, '')).rejects.toThrow(
      'Cannot read WhatsApp gateway token'
    );
  });

  it('rejects a FIFO token path promptly without waiting for another process to open it', async () => {
    await mkdir(authDirectory, { mode: 0o700 });
    await promisify(execFile)('mkfifo', ['-m', '600', gatewayTokenPath(authDirectory)]);
    await expect(readGatewayToken(authDirectory, '')).rejects.toThrow(
      'Invalid WhatsApp gateway token file'
    );
  });

  it('refuses a symlinked authentication directory without changing its target', async () => {
    const target = join(directory, 'target');
    await mkdir(target, { mode: 0o755 });
    await symlink(target, authDirectory);
    await expect(ensureGatewayToken(authDirectory, '')).rejects.toThrow(
      'Invalid WhatsApp authentication directory'
    );
    await expect(readGatewayToken(authDirectory, '')).rejects.toThrow(
      'Cannot read WhatsApp gateway token'
    );
    expect((await lstat(target)).mode & 0o777).toBe(0o755);
    expect(await readdir(target)).toEqual([]);
  });
});
