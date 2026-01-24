import fs from 'node:fs';
import { parse } from 'csv-parse/sync';
import yahooFinance from '@/services/yahoo-finance';

export interface Candle {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjClose?: number;
}

export const DataLoader = {
  async loadHistoricalData(symbol: string, days = 730): Promise<Candle[]> {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);

    try {
      const result = await yahooFinance.historical(symbol, {
        period1: start,
        period2: end,
        interval: '1d',
        includeAdjustedClose: true,
      });

      return result.map((q) => ({
        date: q.date,
        open: q.open,
        high: q.high,
        low: q.low,
        close: q.close,
        volume: q.volume,
        adjClose: q.adjClose,
      }));
    } catch (e) {
      console.error(`Failed to load data for ${symbol}`, e);
      return [];
    }
  },

  loadExisitingPredictions(csvPath: string): Record<string, string>[] {
    if (!fs.existsSync(csvPath)) return [];
    const content = fs.readFileSync(csvPath, 'utf-8');
    return parse(content, {
      columns: true,
      skip_empty_lines: true,
    });
  },
};
