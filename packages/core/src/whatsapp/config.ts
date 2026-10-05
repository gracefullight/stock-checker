import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, type FileHandle, link, lstat, mkdir, open, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const DEFAULT_AUTH_DIRECTORY = fileURLToPath(
  new URL('../../../../data/whatsapp/', import.meta.url)
);
const TOKEN_FILE = 'gateway-token';
const TOKEN_MAX_BYTES = 513;

export interface WhatsAppGatewayConfiguration {
  authDirectory: string;
  port: number;
}

export function resolveWhatsAppAuthDir(environment: NodeJS.ProcessEnv = process.env): string {
  const configured = environment.WHATSAPP_AUTH_DIR?.trim();
  return configured ? resolve(PROJECT_ROOT, configured) : DEFAULT_AUTH_DIRECTORY;
}

export function gatewayTokenPath(authDirectory: string = resolveWhatsAppAuthDir()): string {
  return join(authDirectory, TOKEN_FILE);
}

export function getWhatsAppGatewayConfiguration(
  environment: NodeJS.ProcessEnv = process.env
): WhatsAppGatewayConfiguration {
  const configuredPort = environment.WHATSAPP_GATEWAY_PORT?.trim();
  const port = configuredPort ? Number(configuredPort) : 5102;
  if (
    (configuredPort && !/^\d+$/.test(configuredPort)) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error('Invalid WhatsApp gateway port');
  }
  return { authDirectory: resolveWhatsAppAuthDir(environment), port };
}

function configuredGatewayToken(value: string | undefined): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (!/^[\x21-\x7e]{32,512}$/.test(value)) {
    throw new Error('Invalid WhatsApp gateway token');
  }
  return value;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

/** Read only: consumers must not create a gateway or authentication state. */
export async function readGatewayToken(
  authDirectory: string = resolveWhatsAppAuthDir(),
  configuredToken: string | undefined = process.env.WHATSAPP_GATEWAY_TOKEN
): Promise<string | undefined> {
  const fromEnvironment = configuredGatewayToken(configuredToken);
  if (fromEnvironment) return fromEnvironment;

  let tokenFile: FileHandle;
  try {
    const directory = await lstat(authDirectory);
    if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o077) !== 0) {
      throw new Error('Invalid WhatsApp authentication directory');
    }
    tokenFile = await open(
      gatewayTokenPath(authDirectory),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    );
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return undefined;
    throw new Error('Cannot read WhatsApp gateway token');
  }

  try {
    const metadata = await tokenFile.stat();
    if (
      !metadata.isFile() ||
      (metadata.mode & 0o777) !== 0o600 ||
      metadata.size < 32 ||
      metadata.size > TOKEN_MAX_BYTES
    ) {
      throw new Error('Invalid WhatsApp gateway token file');
    }
    const contents = await tokenFile.readFile('utf8');
    const token = configuredGatewayToken(contents.trimEnd());
    if (!token) throw new Error('Invalid WhatsApp gateway token file');
    return token;
  } finally {
    await tokenFile.close();
  }
}

/** Publish an exclusive, complete private token file, including during concurrent startup. */
export async function ensureGatewayToken(
  authDirectory: string = resolveWhatsAppAuthDir(),
  configuredToken: string | undefined = process.env.WHATSAPP_GATEWAY_TOKEN
): Promise<string> {
  const fromEnvironment = configuredGatewayToken(configuredToken);
  if (fromEnvironment) return fromEnvironment;

  await mkdir(authDirectory, { recursive: true, mode: 0o700 });
  const directory = await lstat(authDirectory);
  if (!directory.isDirectory() || directory.isSymbolicLink()) {
    throw new Error('Invalid WhatsApp authentication directory');
  }
  await chmod(authDirectory, 0o700);
  const existing = await readGatewayToken(authDirectory, '');
  if (existing) return existing;

  const candidate = randomBytes(32).toString('hex');
  const temporaryPath = join(authDirectory, `.gateway-token-${randomBytes(12).toString('hex')}`);
  const tokenFile = await open(
    temporaryPath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600
  );
  try {
    try {
      await tokenFile.chmod(0o600);
      await tokenFile.writeFile(`${candidate}\n`, 'utf8');
    } finally {
      await tokenFile.close();
    }
    try {
      await link(temporaryPath, gatewayTokenPath(authDirectory));
      return candidate;
    } catch (error) {
      if (!hasErrorCode(error, 'EEXIST')) {
        throw new Error('Cannot create WhatsApp gateway token');
      }
      const winner = await readGatewayToken(authDirectory, '');
      if (!winner) throw new Error('Cannot read WhatsApp gateway token');
      return winner;
    }
  } finally {
    await unlink(temporaryPath);
  }
}
