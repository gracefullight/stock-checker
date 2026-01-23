import type { TickerResult } from '../types';

export interface ReportSection {
  title: string;
  content: string;
}

export function generateMarkdownReport(ticker: string, result: TickerResult): ReportSection[] {
  const sections: ReportSection[] = [];

  sections.push({
    title: '## Overview',
    content: `**Ticker:** ${ticker}\n**Date:** ${result.date}\n**Opinion:** ${result.opinion}\n**Score:** ${result.score.toFixed(2)}\n`,
  });

  sections.push({
    title: '## Price Action',
    content: `**Close Price:** $${result.close.toFixed(2)}\n**Volume:** ${result.volume.toLocaleString()}\n`,
  });

  sections.push({
    title: '## Technical Indicators',
    content: `| Indicator | Value |\n|-----------|-------|\n| RSI | ${result.rsi.toFixed(2)} |\n| Stochastic %K | ${result.stochasticK.toFixed(2)} |\n| Bollinger Bands | ${result.bbLower.toFixed(2)} - ${result.bbUpper.toFixed(2)} |\n| Donchian Channels | ${result.donchLower.toFixed(2)} - ${result.donchUpper.toFixed(2)} |\n| Williams %R | ${result.williamsR.toFixed(2)} |\n| ATR | ${result.atr.toFixed(2)} |\n`,
  });

  const riskRewardSection = `| Metric | Value |\n|--------|-------|\n| Stop Loss | $${result.stopLoss.toFixed(2)} |\n| Take Profit | $${result.takeProfit.toFixed(2)} |\n| Trailing Stop | $${result.trailingStop.toFixed(2)} |\n| Trailing Start | $${result.trailingStart.toFixed(2)} |\n`;

  sections.push({
    title: '## Risk Management',
    content: riskRewardSection,
  });

  if (result.patterns.length > 0) {
    const patternsSection = result.patterns
      .map(p => `- ${p}`)
      .join('\n');

    sections.push({
      title: '## Detected Patterns',
      content: patternsSection,
    });
  }

  const sentiment = result.opinion === 'BUY' ? '🐂 Bullish' : result.opinion === 'SELL' ? '🐻 Bearish' : '😐 Neutral';

  sections.push({
    title: '## Market Sentiment',
    content: `${sentiment} - Based on ${result.score.toFixed(2)} combined score`,
  });

  return sections;
}

export function generateMarkdownReportFull(ticker: string, result: TickerResult): string {
  const sections = generateMarkdownReport(ticker, result);
  return sections.map(s => `${s.title}\n${s.content}`).join('\n\n');
}
