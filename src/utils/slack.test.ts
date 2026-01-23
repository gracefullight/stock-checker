import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import { sendSlackNotification } from './slack';
import type { TickerResult } from '../types';

vi.mock('axios');

describe('slack', () => {
  it('should send formatted message to Slack webhook', async () => {
    const mockPost = vi.spyOn(axios, 'post').mockResolvedValue({ status: 200, data: 'ok' });

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
    };

    await sendSlackNotification(data, 'https://hooks.slack.com/test');

    expect(mockPost).toHaveBeenCalledWith(
      'https://hooks.slack.com/test',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const callArgs = mockPost.mock.calls[0][1] as { data: string };
    expect(JSON.parse(callArgs.data).text).toContain('TSLA');
    expect(JSON.parse(callArgs.data).text).toContain('BUY');
  });
});
