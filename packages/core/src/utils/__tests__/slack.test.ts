import { describe, expect, it, vi } from 'vitest';
import type { TickerResult } from '@/types';
import { formatSlackMessage, isSlackWebhookSuccess, sendSlackNotification } from '@/utils/slack';

const data: TickerResult = {
  ticker: 'TSLA',
  date: '2026-01-24',
  close: 200,
  volume: 1000000,
  rsi: 50,
  stochasticK: 50,
  bbLower: 190,
  bbUpper: 210,
  donchLower: 185,
  donchUpper: 215,
  williamsR: -50,
  fearGreed: 50,
  patterns: [],
  score: 250,
  opinion: 'BUY',
  atr: 5,
  stopLoss: 195,
  takeProfit: 205,
  trailingStop: 195,
  trailingStart: 202.5,
  macd: 0,
  macdSignal: 0,
  macdHistogram: 0,
  sma20: 195,
  ema20: 195,
};

describe('slack', () => {
  it('posts the formatted message with a timeout and treats the `ok` body as success', async () => {
    const post = vi.fn().mockResolvedValue({ status: 200, data: 'ok' });
    const logger = { error: vi.fn() };
    await sendSlackNotification(data, 'https://hooks.slack.com/test', { post, logger });
    expect(post).toHaveBeenCalledWith(
      'https://hooks.slack.com/test',
      expect.objectContaining({ text: expect.stringContaining('TSLA') }),
      { timeout: 10_000 }
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs only real webhook failures and never throws', async () => {
    const logger = { error: vi.fn() };
    await sendSlackNotification(data, 'https://hooks.slack.com/test', {
      post: vi.fn().mockResolvedValue({ status: 200, data: 'invalid_payload' }),
      logger,
    });
    await sendSlackNotification(data, 'https://hooks.slack.com/test', {
      post: vi.fn().mockRejectedValue(new Error('timeout of 10000ms exceeded')),
      logger,
    });
    expect(logger.error).toHaveBeenCalledTimes(2);
    expect(isSlackWebhookSuccess({ status: 200, data: 'ok' })).toBe(true);
    expect(isSlackWebhookSuccess({ status: 200, data: { ok: true } })).toBe(true);
    expect(isSlackWebhookSuccess({ status: 302, data: 'ok' })).toBe(false);
    expect(isSlackWebhookSuccess({ status: 200, data: 'no_service' })).toBe(false);
  });

  it('renders BUY with reference levels and SELL without stop or target levels', () => {
    const buy = formatSlackMessage(data);
    expect(buy).toContain('2026-01-24 TSLA BUY');
    expect(buy).toContain('Stop Loss (reference, not validated): 195.00');
    expect(buy).toContain('enter next session open, exit fifth session close');
    const sell = formatSlackMessage({ ...data, opinion: 'SELL' });
    expect(sell).toContain('TSLA SELL');
    expect(sell).toContain('long-holder exit warning');
    expect(sell).not.toMatch(/Stop Loss|Take Profit|Trailing/);
  });
});
