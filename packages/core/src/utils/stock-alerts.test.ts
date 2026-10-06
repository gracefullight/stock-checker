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
        'AAPL BUY · 종가 100.00 · ATR 손절 97.00 · 목표 106.00',
        'OII SELL · 종가 100.00 · 보유 포지션 청산 경고',
        '',
        'BUY 1 · SELL 1 · 알림 2/2개',
        '종가·ATR 가격은 체결가가 아닌 참고값입니다. 신호점수는 승률이 아닙니다.',
      ].join('\n'),
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
    expect(notification?.asOf).toBe('종가 2026-09-30~2026-10-01');
    expect(notification?.summary).toContain('BUY 8 · SELL 0');
    expect(notification?.summary).toContain('STOCK4 BUY');
    expect(notification?.summary).not.toContain('STOCK5 BUY');
    expect(notification?.summary).toContain('알림 5/8개');
  });
});
