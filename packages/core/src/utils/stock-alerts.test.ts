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
      title: '주식 신호',
      asOf: '종가 2026-10-01',
      summary: [
        'AAPL BUY · 종가 참고 100.00 · ATR 손절 참고 97.00 · 목표 참고 106.00',
        'OII SELL · 종가 참고 100.00 · 보유 포지션 청산 경고',
      ].join('\n'),
    });
    expect(notification?.summary).not.toContain('%');
    expect(notification?.summary).not.toContain('HOLD');
    expect(notification?.summary).not.toMatch(/알림|승률|해석 주의|결과 범위/);
  });

  it('limits ticker details and preserves differing bar dates without adding a footer', () => {
    const notification = buildStockSignalNotification(
      Array.from({ length: 8 }, (_, index) => ({
        ...reference,
        ticker: `STOCK${index}`,
        date: index === 7 ? '2026-09-30' : reference.date,
      }))
    );
    expect(notification?.asOf).toBe('종가 2026-09-30~2026-10-01');
    expect(notification?.summary).toContain('STOCK4 BUY');
    expect(notification?.summary).not.toContain('STOCK5 BUY');
    expect(notification?.summary?.split('\n')).toHaveLength(5);
    expect(notification?.summary).not.toMatch(/알림|승률|결과 범위/);
  });
});
