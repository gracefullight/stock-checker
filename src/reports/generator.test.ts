import { describe, it, expect } from 'vitest';
import { generateMarkdownReportFull, generateMarkdownReport, type ReportSection } from './generator';
import type { TickerResult } from '../types';

describe('report generator', () => {
  describe('generateMarkdownReport', () => {
    it('should generate complete markdown report', () => {
      const result: TickerResult = {
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
        score: 100,
        opinion: 'HOLD',
        atr: 5,
        stopLoss: 195,
        takeProfit: 205,
        trailingStop: 195,
        trailingStart: 202.5,
      };

      const sections = generateMarkdownReport('TSLA', result);

      expect(sections).toHaveLength(5);
      expect(sections[0].title).toBe('## Overview');
      expect(sections[1].title).toBe('## Price Action');
      expect(sections[2].title).toBe('## Technical Indicators');
      expect(sections[3].title).toBe('## Risk Management');
      expect(sections[4].title).toBe('## Market Sentiment');
    });

    it('should include patterns section when patterns exist', () => {
      const result: TickerResult = {
        ...getBaseResult(),
        patterns: ['AscendingTriangle', 'BullishFlag'],
        score: 150,
      };

      const sections = generateMarkdownReport('TSLA', result);

      expect(sections).toHaveLength(6);
      expect(sections[4].title).toBe('## Detected Patterns');
    });
  });

  describe('generateMarkdownReportFull', () => {
    it('should convert report sections to full markdown string', () => {
      const sections: ReportSection[] = [
        { title: '## Overview', content: 'Test' },
        { title: '## Details', content: 'Test content' },
      ];

      const full = sections.map(s => `${s.title}\n${s.content}`).join('\n\n');

      expect(full).toBe('## Overview\nTest\n\n## Details\nTest content');
    });
  });
});

function getBaseResult(): TickerResult {
  return {
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
    score: 100,
    opinion: 'HOLD',
    atr: 5,
    stopLoss: 195,
    takeProfit: 205,
    trailingStop: 195,
    trailingStart: 202.5,
  };
}
