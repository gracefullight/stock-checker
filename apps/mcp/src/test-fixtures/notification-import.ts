import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import { fixtureScreen } from '@mcp/test-fixtures/screen.ts';

let providerCalls = 0;
mock.module('@stock-checker/core/src/services/data-fetcher.ts', () => ({
  getHistoricalPrices: async () => {
    providerCalls++;
    throw new Error('The pure formatter must not request market data');
  },
}));
globalThis.fetch = Object.assign(
  async () => {
    throw new Error('The pure formatter must not make network requests');
  },
  {
    preconnect: () => {
      throw new Error('The pure formatter must not open network connections');
    },
  }
);

// This import must stay cold until the deliberately partial provider mock is active.
const { buildStockScreenWhatsAppNotification } = await import(
  '@stock-checker/core/src/utils/stock-screen-alerts.ts'
);
const message = buildStockScreenWhatsAppNotification(fixtureScreen());
assert.equal(providerCalls, 0);
assert.match(message.summary, /AAPL BUY · 종가일 2026-10-02 · 참고 100\.00/);
assert.match(message.summary, /분석 1\/1 · 일치 1 · 자료 없음 0/);
process.stdout.write(JSON.stringify({ message, providerCalls }));
