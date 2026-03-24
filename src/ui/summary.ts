import pc from 'picocolors';
import type { TickerResult } from '@/types';

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

function colorConfidence(confidence: string): string {
  switch (confidence) {
    case 'very-high':
      return pc.green(confidence);
    case 'high':
      return pc.cyan(confidence);
    case 'medium':
      return pc.yellow(confidence);
    default:
      return pc.dim(confidence);
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
  const visible = str.replace(/\x1b\[[0-9;]*m/g, '');
  const padding = Math.max(0, len - visible.length);
  return str + ' '.repeat(padding);
}

function padStart(str: string, len: number): string {
  const visible = str.replace(/\x1b\[[0-9;]*m/g, '');
  const padding = Math.max(0, len - visible.length);
  return ' '.repeat(padding) + str;
}

export function printSummaryTable(results: TickerResult[]): void {
  if (results.length === 0) return;

  const divider = pc.dim('─'.repeat(96));

  console.log();
  console.log(pc.bold(' Stock Analysis Summary'));
  console.log(divider);
  console.log(
    pc.dim(
      ` ${pad('Ticker', 8)} ${padStart('Close', 10)} ${padStart('RSI', 7)} ${padStart('Score', 8)} ${pad('Opinion', 12)} ${padStart('Buy%', 6)} ${padStart('Sell%', 6)} ${pad('Confidence', 12)} ${pad('Patterns', 14)}`
    )
  );
  console.log(divider);

  for (const r of results) {
    const ticker = pad(pc.bold(r.ticker), 8);
    const close = padStart(`$${r.close.toFixed(2)}`, 10);
    const rsi = padStart(colorRsi(r.rsi), 7);
    const score = padStart(r.score.toFixed(1), 8);
    const opinion = pad(colorOpinion(r.opinion), 12);
    const buyProb = padStart(`${(r.buyProbability ?? 0).toFixed(0)}%`, 6);
    const sellProb = padStart(`${(r.sellProbability ?? 0).toFixed(0)}%`, 6);
    const confidence = pad(colorConfidence(r.confidence ?? 'medium'), 12);
    const patterns = r.patterns.length > 0 ? pc.dim(r.patterns.join(', ')) : pc.dim('—');

    console.log(` ${ticker} ${close} ${rsi} ${score} ${opinion} ${buyProb} ${sellProb} ${confidence} ${patterns}`);
  }

  console.log(divider);

  const buyCount = results.filter((r) => r.opinion === 'BUY').length;
  const sellCount = results.filter((r) => r.opinion === 'SELL').length;
  const holdCount = results.filter((r) => r.opinion === 'HOLD').length;

  console.log(
    ` ${pc.dim('Total:')} ${results.length} stocks  ${pc.green(`BUY ${buyCount}`)}  ${pc.red(`SELL ${sellCount}`)}  ${pc.yellow(`HOLD ${holdCount}`)}`
  );
  console.log();
}
