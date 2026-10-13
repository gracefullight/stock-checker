import axios from 'axios';
import pino from 'pino';
import type { TickerResult } from '@/types';

const logger = pino({
  level: 'debug',
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: { target: 'pino-pretty' },
});

const REQUEST_TIMEOUT_MS = 10_000;

export interface SlackDependencies {
  post?: typeof axios.post;
  logger?: Pick<typeof logger, 'error'>;
}

/**
 * Slack text for one signal. SELL is a long-holder exit warning, so it carries no
 * ATR stop/target levels; those are shown for BUY only and are outside the
 * validated next-open/fifth-close rule.
 */
export function formatSlackMessage(item: TickerResult): string {
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
    `- Average daily price range (including gaps): ${item.atr.toFixed(2)}`,
  ];
  if (item.opinion === 'BUY') {
    lines.push(
      '- Plan: enter next session open, exit fifth session close (validated rule)',
      `- Stop Loss (reference, not validated): ${item.stopLoss.toFixed(2)}`,
      `- Take Profit (reference, not validated): ${item.takeProfit.toFixed(2)}`,
      `- Trailing Stop: ${item.trailingStop.toFixed(2)}`,
      `- Trailing Start: ${item.trailingStart.toFixed(2)}`
    );
  } else if (item.opinion === 'SELL') {
    lines.push('- SELL is a long-holder exit warning, not a short-entry recommendation');
  }
  return `${item.date} ${item.ticker} ${item.opinion}\n${lines.join('\n')}`;
}

/** Slack incoming webhooks answer 200 with the plain text body `ok`; anything else is a failure. */
export function isSlackWebhookSuccess(response: { status: number; data: unknown }): boolean {
  if (response.status < 200 || response.status >= 300) return false;
  return typeof response.data === 'string' ? response.data.trim().toLowerCase() === 'ok' : true;
}

export async function sendSlackNotification(
  item: TickerResult,
  webhook: string,
  dependencies: SlackDependencies = {}
): Promise<void> {
  const post = dependencies.post ?? axios.post;
  const log = dependencies.logger ?? logger;
  const text = formatSlackMessage(item);
  try {
    const res = await post(webhook, { text }, { timeout: REQUEST_TIMEOUT_MS });
    if (!isSlackWebhookSuccess(res)) {
      log.error({ status: res.status }, 'Slack webhook failed');
    }
  } catch (err) {
    log.error({ err }, 'Slack notification error');
  }
}
