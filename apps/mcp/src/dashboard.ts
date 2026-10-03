import { execFile } from 'node:child_process';
import { createConnection } from 'node:net';

const DEFAULT_DASHBOARD_URL = 'http://localhost:5100';
const TICKER_PATTERN = /^\^?[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*(?:=[A-Za-z0-9]+)?$/;
const READINESS_TIMEOUT_MS = 1500;
const BROWSER_TIMEOUT_MS = 3000;

export interface DashboardResult {
  ticker: string;
  url: string | null;
  opened: boolean;
  readiness: 'listening' | 'unavailable' | 'unknown';
  status: 'opened' | 'not_running' | 'open_failed' | 'invalid_configuration';
  message: string;
}

export interface DashboardDependencies {
  baseUrl?: string;
  checkReadiness?: (url: URL) => Promise<boolean>;
  openBrowser?: (url: string) => Promise<void>;
}

export function buildDashboardUrl(
  ticker: string,
  baseUrl = process.env.STOCK_CHECKER_DASHBOARD_URL || DEFAULT_DASHBOARD_URL
): URL {
  const symbol = ticker.trim().toUpperCase();
  if (symbol.length < 1 || symbol.length > 32 || !TICKER_PATTERN.test(symbol)) {
    throw new Error('Invalid dashboard ticker.');
  }
  const url = new URL(baseUrl);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('Invalid dashboard configuration.');
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${encodeURIComponent(symbol)}`;
  return url;
}

export function isDashboardListening(url: URL): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({
      host: url.hostname.replace(/^\[|\]$/g, ''),
      port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
    });
    let settled = false;
    const finish = (listening: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      resolve(listening);
    };
    const timeout = setTimeout(() => finish(false), READINESS_TIMEOUT_MS);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

export function browserCommand(
  url: string,
  platform: NodeJS.Platform = process.platform
): { command: string; args: string[] } {
  switch (platform) {
    case 'darwin':
      return { command: 'open', args: [url] };
    case 'linux':
      return { command: 'xdg-open', args: [url] };
    case 'win32':
      return { command: 'explorer.exe', args: [url] };
    default:
      throw new Error('No browser launcher is available on this platform.');
  }
}

export function launchBrowser(url: string): Promise<void> {
  const { command, args } = browserCommand(url);
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: BROWSER_TIMEOUT_MS, windowsHide: true }, (error) => {
      if (error) reject(new Error('The browser launcher failed.'));
      else resolve();
    });
  });
}

export async function openStockDashboard(
  ticker: string,
  dependencies: DashboardDependencies = {}
): Promise<DashboardResult> {
  const symbol = ticker.trim().toUpperCase();
  let url: URL;
  try {
    url = buildDashboardUrl(symbol, dependencies.baseUrl);
  } catch {
    return {
      ticker: symbol,
      url: null,
      opened: false,
      readiness: 'unknown',
      status: 'invalid_configuration',
      message:
        'Dashboard configuration is invalid. Set STOCK_CHECKER_DASHBOARD_URL to an HTTP or HTTPS base URL without credentials, query parameters, or a fragment.',
    };
  }
  const result = { ticker: symbol, url: url.toString(), opened: false };
  let listening = false;
  try {
    listening = await (dependencies.checkReadiness ?? isDashboardListening)(url);
  } catch {
    // Readiness failures must still return a usable dashboard link.
  }
  if (!listening) {
    return {
      ...result,
      readiness: 'unavailable',
      status: 'not_running',
      message:
        'The dashboard web listener is unavailable. Run `mise run dev`, then call this tool again or open the link.',
    };
  }
  try {
    await (dependencies.openBrowser ?? launchBrowser)(url.toString());
    return {
      ...result,
      opened: true,
      readiness: 'listening',
      status: 'opened',
      message:
        'Browser launch requested. The web port is listening; API and market-data availability have not been checked.',
    };
  } catch {
    return {
      ...result,
      readiness: 'listening',
      status: 'open_failed',
      message: 'The browser could not be launched. Open the dashboard link manually.',
    };
  }
}

export function renderDashboardResult(result: DashboardResult): string {
  return result.url
    ? `[${result.ticker} dashboard](${result.url})\n\n${result.message}`
    : result.message;
}
