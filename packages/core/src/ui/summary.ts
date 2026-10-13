import pc from 'picocolors';
import type { TickerResult } from '@/types';

/**
 * Measured base rate of the leader-pullback strategy on the frozen validation
 * dataset (docs/validation/leader-pullback-2026-10-06.md). In-sample; it is a
 * description of past paper trades, not a forward win probability.
 */
export const VALIDATED_BASE_RATE = {
  trades: 155,
  winRatePct: 57.4,
  meanNetReturnPct: 0.63,
  horizon: 'next open → 5th session close, 10 bps round trip',
  benchmark: {
    symbol: 'SPY',
    meanNetReturnPct: 0.48,
    winRatePct: 63.2,
  },
} as const;

function colorOpinion(opinion: string): string {
  switch (opinion) {
    case 'BUY':
      return pc.green(pc.bold(opinion));
    case 'SELL':
      return pc.red(pc.bold(opinion));
    default:
      return pc.yellow(opinion);
  }
}

function colorRsi(rsi: number): string {
  const val = rsi.toFixed(1);
  if (rsi < 30) return pc.green(val);
  if (rsi > 70) return pc.red(val);
  return val;
}

function pad(str: string, len: number): string {
  // Strip ANSI codes to calculate visible length
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (\x1b) is required to match ANSI SGR escape sequences for visible-width calculation.
  const visible = str.replace(/\x1b\[[0-9;]*m/g, '');
  const padding = Math.max(0, len - visible.length);
  return str + ' '.repeat(padding);
}

function padStart(str: string, len: number): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (\x1b) is required to match ANSI SGR escape sequences for visible-width calculation.
  const visible = str.replace(/\x1b\[[0-9;]*m/g, '');
  const padding = Math.max(0, len - visible.length);
  return ' '.repeat(padding) + str;
}

/**
 * Legacy buy/sell score shares. They describe how the raw score splits, not a
 * probability of profit, and they are hidden for HOLD rows: a HOLD is a blocked
 * setup, so a large buy share there would read as a strong buy cue.
 */
export function formatScoreMix(result: TickerResult): string {
  if (result.opinion !== 'BUY' && result.opinion !== 'SELL') return '—';
  const buy = result.buyProbability;
  const sell = result.sellProbability;
  if (buy === undefined && sell === undefined) return '—';
  return `B${(buy ?? 0).toFixed(0)}/S${(sell ?? 0).toFixed(0)}`;
}

export function formatBaseRateLines(): string[] {
  const rate = VALIDATED_BASE_RATE;
  const sign = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  return [
    `Validated base rate (in-sample, ${rate.horizon}): n=${rate.trades} trades, ${rate.winRatePct.toFixed(1)}% positive, ${sign(rate.meanNetReturnPct)} mean net per trade.`,
    `Benchmark: ${rate.benchmark.symbol} over the same windows ${sign(rate.benchmark.meanNetReturnPct)} mean, ${rate.benchmark.winRatePct.toFixed(1)}% positive; no stock-selection edge over ${rate.benchmark.symbol} has been measured. Scores are not win probabilities.`,
  ];
}

export function printSummaryTable(results: TickerResult[]): void {
  if (results.length === 0) return;

  const divider = pc.dim('─'.repeat(96));

  console.log();
  console.log(pc.bold(' Stock Analysis Summary'));
  console.log(divider);
  console.log(
    pc.dim(
      ` ${pad('Ticker', 8)} ${padStart('Close', 10)} ${padStart('RSI', 7)} ${padStart('Score', 8)} ${pad('Opinion', 12)} ${pad('Score mix', 10)} ${pad('Trend', 10)} ${pad('Patterns', 14)}`
    )
  );
  console.log(divider);

  for (const r of results) {
    const ticker = pad(pc.bold(r.ticker), 8);
    const close = padStart(`$${r.close.toFixed(2)}`, 10);
    const rsi = padStart(colorRsi(r.rsi), 7);
    const score = padStart(r.score.toFixed(1), 8);
    const opinion = pad(colorOpinion(r.opinion), 12);
    const mix = pad(formatScoreMix(r), 10);
    const trend = pad(r.trendRegime ? pc.dim(r.trendRegime) : pc.dim('—'), 10);
    const patterns = r.patterns.length > 0 ? pc.dim(r.patterns.join(', ')) : pc.dim('—');

    console.log(` ${ticker} ${close} ${rsi} ${score} ${opinion} ${mix} ${trend} ${patterns}`);
  }

  console.log(divider);

  const buyCount = results.filter((r) => r.opinion === 'BUY').length;
  const sellCount = results.filter((r) => r.opinion === 'SELL').length;
  const holdCount = results.filter((r) => r.opinion === 'HOLD').length;

  console.log(
    ` ${pc.dim('Total:')} ${results.length} stocks  ${pc.green(`BUY ${buyCount}`)}  ${pc.red(`SELL ${sellCount}`)}  ${pc.yellow(`HOLD ${holdCount}`)}`
  );
  for (const line of formatBaseRateLines()) console.log(` ${pc.dim(line)}`);
  console.log();
}
