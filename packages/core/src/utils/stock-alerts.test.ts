import { describe, expect, it } from 'vitest';
import { buildStockSignalNotification } from '@/utils/stock-alerts';

const reference = {
  ticker: 'AAPL',
  date: '2026-10-01',
  opinion: 'BUY',
  close: 100,
  stopLoss: 97,
  takeProfit: 106,
};

describe('stock signal notification', () => {
  it('skips empty runs and HOLD-only runs', () => {
    expect(buildStockSignalNotification([])).toBeNull();
    expect(buildStockSignalNotification([{ ...reference, opinion: 'HOLD' }])).toBeNull();
  });

  it('summarizes BUY reference levels and SELL exits without inventing win rates', () => {
    const notification = buildStockSignalNotification([
      reference,
      { ...reference, ticker: 'OII', opinion: 'SELL' },
      { ...reference, ticker: 'HOLD', opinion: 'HOLD' },
    ]);
    expect(notification).toEqual({
      title: 'Stock signals',
      asOf: '2026-10-01',
      summary:
        'BUY 1; SELL 1; AAPL BUY close 100.00, ATR stop 97.00, target 106.00; OII SELL close 100.00 (exit signal). Prices are completed-close references.',
    });
    expect(notification?.summary).not.toContain('%');
    expect(notification?.summary).not.toContain('HOLD');
  });

  it('limits ticker details while preserving batch counts and differing bar dates', () => {
    const notification = buildStockSignalNotification(
      Array.from({ length: 8 }, (_, index) => ({
        ...reference,
        ticker: `STOCK${index}`,
        date: index === 7 ? '2026-09-30' : reference.date,
      }))
    );
    expect(notification?.asOf).toBe('2026-09-30 to 2026-10-01');
    expect(notification?.summary).toContain('BUY 8; SELL 0');
    expect(notification?.summary).toContain('STOCK4 BUY');
    expect(notification?.summary).not.toContain('STOCK5 BUY');
    expect(notification?.summary).toContain('showing 5 of 8');
  });
});
