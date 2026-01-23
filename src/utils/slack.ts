import axios from 'axios';
import pino from 'pino';
import type { TickerResult } from '../types';

const logger = pino({
  level: 'debug',
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: { target: 'pino-pretty' }
});

export async function sendSlackNotification(item: TickerResult, webhook: string): Promise<void> {
  const lines = [
    `- Close: ${item.close.toFixed(2)}`,
    `- Volume: ${item.volume}`,
    `- RSI: ${item.rsi.toFixed(2)}`,
    `- StochK: ${item.stochasticK.toFixed(2)}`,
    `- Bollinger Bands: ${item.bbLower.toFixed(2)} - ${item.bbUpper.toFixed(2)}`,
    `- Donchian Channels: ${item.donchLower.toFixed(2)} - ${item.donchUpper.toFixed(2)}`,
    `- Williams %R: ${item.williamsR.toFixed(2)}`,
    `- Fear & Greed: ${item.fearGreed ?? 'N/A'}`,
    `- Patterns: ${item.patterns.length ? item.patterns.join(', ') : 'None'}`,
    `- Score: ${item.score.toFixed(2)}`,
    `- ATR: ${item.atr.toFixed(2)}`,
    `- Stop Loss: ${item.stopLoss.toFixed(2)}`,
    `- Take Profit: ${item.takeProfit.toFixed(2)}`,
    `- Trailing Stop: ${item.trailingStop.toFixed(2)}`,
    `- Trailing Start: ${item.trailingStart.toFixed(2)}`
  ];
  const text = `${item.date} ${item.ticker} ${item.opinion}\n${lines.join('\n')}`;

  try {
    const res = await axios.post(webhook, { text });
    if (!res.data.ok) {
      logger.error({ status: res.status }, 'Slack webhook failed');
    }
  } catch (err) {
    logger.error({ err }, 'Slack notification error');
  }
}