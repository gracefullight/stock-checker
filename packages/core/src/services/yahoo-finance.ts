import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance({
  suppressNotices: ['yahooSurvey', 'ripHistorical'],
});

export interface YahooDailyRow {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  adjClose: number;
  volume: number;
}

/**
 * Daily OHLCV via chart(). historical() is a compatibility shim over chart()
 * whose row validation rejects the entire response whenever Yahoo appends an
 * in-progress bar with null close — which it does on every live trading day —
 * so we call chart() directly and drop incomplete bars ourselves.
 */
export async function fetchYahooDaily(
  symbol: string,
  period1: Date,
  period2: Date
): Promise<YahooDailyRow[]> {
  const { quotes } = await yahooFinance.chart(symbol, {
    period1,
    period2,
    interval: '1d',
  });

  const rows: YahooDailyRow[] = [];
  for (const q of quotes) {
    if (q.close == null || q.open == null || q.high == null || q.low == null) continue;
    rows.push({
      date: q.date,
      open: q.open,
      high: q.high,
      low: q.low,
      close: q.close,
      adjClose: q.adjclose ?? q.close,
      volume: q.volume ?? 0,
    });
  }
  return rows;
}

export default yahooFinance;
