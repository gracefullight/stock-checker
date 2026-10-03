import { describe, expect, mock, test } from 'bun:test';
import { createServer } from 'node:net';
import {
  browserCommand,
  buildDashboardUrl,
  isDashboardListening,
  openStockDashboard,
  renderDashboardResult,
} from '@mcp/dashboard.ts';

describe('ticker dashboard', () => {
  test.each([
    [' aapl ', 'AAPL'],
    ['brk-b', 'BRK-B'],
    ['^GSPC', '%5EGSPC'],
    ['005930.KS', '005930.KS'],
    ['CL=F', 'CL%3DF'],
  ])('builds an encoded detail URL for %s', (ticker, path) => {
    expect(buildDashboardUrl(ticker, 'http://localhost:5100').toString()).toBe(
      `http://localhost:5100/${path}`
    );
  });

  test('preserves a configured path prefix and removes trailing slashes', () => {
    expect(buildDashboardUrl('OII', 'https://stocks.example/finance///').toString()).toBe(
      'https://stocks.example/finance/OII'
    );
  });

  test('uses the environment configuration and the local default', () => {
    const original = process.env.STOCK_CHECKER_DASHBOARD_URL;
    try {
      process.env.STOCK_CHECKER_DASHBOARD_URL = 'https://stocks.example/app';
      expect(buildDashboardUrl('OII').toString()).toBe('https://stocks.example/app/OII');
      delete process.env.STOCK_CHECKER_DASHBOARD_URL;
      expect(buildDashboardUrl('OII').toString()).toBe('http://localhost:5100/OII');
    } finally {
      if (original === undefined) delete process.env.STOCK_CHECKER_DASHBOARD_URL;
      else process.env.STOCK_CHECKER_DASHBOARD_URL = original;
    }
  });

  test.each([
    '',
    '../OII',
    'OII/MSFT',
    'OII;open',
    'OII\u0000',
    'A'.repeat(33),
    'https://example.com',
  ])('rejects a ticker that could alter the URL or command: %s', (ticker) => {
    expect(() => buildDashboardUrl(ticker, 'http://localhost:5100')).toThrow();
  });

  test.each([
    'invalid-url',
    'file:///tmp/dashboard',
    'javascript:alert(1)',
    'ftp://stocks.example',
    'https://user:fixture-secret@stocks.example',
    'https://stocks.example/?key=fixture-secret',
    'https://stocks.example/#fixture-secret',
  ])('rejects invalid configuration without exposing it: %s', async (baseUrl) => {
    const checkReadiness = mock(async () => true);
    const openBrowser = mock(async () => {});
    const result = await openStockDashboard('OII', { baseUrl, checkReadiness, openBrowser });
    expect(result).toMatchObject({
      ticker: 'OII',
      url: null,
      opened: false,
      readiness: 'unknown',
      status: 'invalid_configuration',
    });
    expect(JSON.stringify(result)).not.toContain('fixture-secret');
    expect(checkReadiness).not.toHaveBeenCalled();
    expect(openBrowser).not.toHaveBeenCalled();
  });

  test('returns a usable link without launching a browser when the listener is stopped', async () => {
    const openBrowser = mock(async () => {});
    const result = await openStockDashboard(' oii ', {
      baseUrl: 'http://localhost:5100',
      checkReadiness: async () => false,
      openBrowser,
    });
    expect(result).toMatchObject({
      ticker: 'OII',
      url: 'http://localhost:5100/OII',
      opened: false,
      readiness: 'unavailable',
      status: 'not_running',
    });
    expect(renderDashboardResult(result)).toContain('[OII dashboard](http://localhost:5100/OII)');
    expect(result.message).toContain('mise run dev');
    expect(openBrowser).not.toHaveBeenCalled();
  });

  test('sanitizes readiness errors and does not launch a browser', async () => {
    const openBrowser = mock(async () => {});
    const result = await openStockDashboard('OII', {
      baseUrl: 'http://localhost:5100',
      checkReadiness: async () => {
        throw new Error('Provider failed: fixture-secret');
      },
      openBrowser,
    });
    expect(result.status).toBe('not_running');
    expect(JSON.stringify(result)).not.toContain('fixture-secret');
    expect(openBrowser).not.toHaveBeenCalled();
  });

  test('launches only the encoded URL after the web listener is available', async () => {
    const checkReadiness = mock(async () => true);
    const openBrowser = mock(async () => {});
    const result = await openStockDashboard('^gspc', {
      baseUrl: 'http://localhost:5100',
      checkReadiness,
      openBrowser,
    });
    expect(result).toMatchObject({
      ticker: '^GSPC',
      url: 'http://localhost:5100/%5EGSPC',
      opened: true,
      readiness: 'listening',
      status: 'opened',
    });
    expect(checkReadiness).toHaveBeenCalledTimes(1);
    expect(openBrowser).toHaveBeenCalledWith('http://localhost:5100/%5EGSPC');
    expect(result.message).toContain('API and market-data availability have not been checked');
  });

  test('keeps the link and sanitizes browser launcher failures', async () => {
    const result = await openStockDashboard('OII', {
      baseUrl: 'https://stocks.example',
      checkReadiness: async () => true,
      openBrowser: async () => {
        throw new Error('Browser stderr: fixture-secret');
      },
    });
    expect(result).toMatchObject({
      url: 'https://stocks.example/OII',
      opened: false,
      readiness: 'listening',
      status: 'open_failed',
    });
    expect(result.message).toContain('manually');
    expect(JSON.stringify(result)).not.toContain('fixture-secret');
  });

  test.each([
    ['darwin', 'open'],
    ['linux', 'xdg-open'],
    ['win32', 'explorer.exe'],
  ] as const)('selects an argument-based browser launcher for %s', (platform, command) => {
    const url = 'https://stocks.example/BRK-B';
    expect(browserCommand(url, platform)).toEqual({ command, args: [url] });
  });

  test('rejects unsupported platforms without falling back to a shell', () => {
    expect(() => browserCommand('http://localhost:5100/OII', 'freebsd')).toThrow();
  });

  test('checks a TCP listener and detects when it is closed', async () => {
    const server = createServer((socket) => socket.destroy());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture port');
    const url = new URL(`http://127.0.0.1:${address.port}/OII`);
    try {
      expect(await isDashboardListening(url)).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
    expect(await isDashboardListening(url)).toBe(false);
  });
});
