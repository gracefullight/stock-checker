import { expect, test } from 'bun:test';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);

test('cold notification formatter imports after a partial market-provider mock without loading providers', async () => {
  const { stdout, stderr } = await execute(
    process.execPath,
    [fileURLToPath(new URL('./test-fixtures/notification-import.ts', import.meta.url))],
    {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      timeout: 8_000,
      killSignal: 'SIGKILL',
      maxBuffer: 64 * 1024,
    }
  );
  expect(stderr).toBe('');
  expect(JSON.parse(stdout)).toMatchObject({
    providerCalls: 0,
    message: {
      title: 'Stock Checker screen: BUY available',
      summary: expect.stringContaining('AAPL BUY bar 2026-10-02 reference 100.00'),
    },
  });
}, 10_000);
