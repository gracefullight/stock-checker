import { DEFAULT_ROUND_TRIP_COST_PCT } from '@/constants';
import {
  buildTickerContext,
  runSignalsWithContext,
  type TickerContext,
} from '@/optimization/engine';
import type { BacktestMetrics } from '@/optimization/types';
import type { PipelineConfig } from '@/types';

interface Candle {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjClose?: number;
  dollarVolume?: number;
}

interface Trade {
  entryDate: Date;
  exitDate: Date;
  entryPrice: number;
  exitPrice: number;
  direction: 'long' | 'short';
  profit: number;
  profitPercent: number;
}

interface BenchmarkData {
  spy: Array<{ date: Date; close: number; volume: number; high: number; low: number }>;
  sector: Array<{ date: Date; close: number; volume: number; high: number; low: number }>;
}

export class Backtester {
  private data: Candle[];
  private context: TickerContext | null;

  constructor(data: Candle[], benchmarkData?: BenchmarkData) {
    this.data = data;
    this.context = buildTickerContext(data, benchmarkData?.spy, benchmarkData?.sector);
  }

  public run(params: PipelineConfig, initialCapital = 10000): BacktestMetrics {
    const signals = this.generateSignals(params);
    const trades = this.simulateTrades(signals);
    return this.calculateMetrics(trades, initialCapital);
  }

  private generateSignals(params: PipelineConfig): ('BUY' | 'SELL' | 'HOLD')[] {
    const signals: ('BUY' | 'SELL' | 'HOLD')[] = new Array(this.data.length).fill('HOLD');
    if (!this.context) return signals;
    const idxByTime = new Map(this.data.map((bar, i) => [bar.date.getTime(), i]));
    for (const signal of runSignalsWithContext(this.context, 'BACKTEST', params)) {
      const idx = idxByTime.get(signal.date.getTime());
      if (idx !== undefined) signals[idx] = signal.decision;
    }
    return signals;
  }

  private simulateTrades(signals: ('BUY' | 'SELL' | 'HOLD')[]): Trade[] {
    const trades: Trade[] = [];
    let position: { price: number; date: Date } | null = null;
    const closes = this.data.map((d) => d.close);
    const dates = this.data.map((d) => d.date);

    for (let i = 1; i < signals.length; i++) {
      const signal = signals[i - 1];
      const price = this.data[i].open;
      const date = dates[i];

      if (position && signal === 'SELL') {
        const profitPercent =
          ((price - position.price) / position.price) * 100 - DEFAULT_ROUND_TRIP_COST_PCT;
        const profit = position.price * (profitPercent / 100);
        trades.push({
          entryDate: position.date,
          exitDate: date,
          entryPrice: position.price,
          exitPrice: price,
          direction: 'long',
          profit,
          profitPercent,
        });
        position = null;
      } else if (!position && signal === 'BUY') {
        position = { price, date };
      }
    }

    // Close position at end
    if (position) {
      const i = signals.length - 1;
      const price = closes[i];
      const date = dates[i];
      const profitPercent =
        ((price - position.price) / position.price) * 100 - DEFAULT_ROUND_TRIP_COST_PCT;
      const profit = position.price * (profitPercent / 100);
      trades.push({
        entryDate: position.date,
        exitDate: date,
        entryPrice: position.price,
        exitPrice: price,
        direction: 'long',
        profit,
        profitPercent,
      });
    }

    return trades;
  }

  private calculateMetrics(trades: Trade[], initialCapital: number): BacktestMetrics {
    const closes = this.data.map((d) => d.close);
    const dailyEquity: number[] = new Array(closes.length).fill(initialCapital);
    let currentBalance = initialCapital;
    let inPosition = false;
    let entryPrice = 0;

    let tradeIdx = 0;
    const realizedProfits: number[] = [];
    for (let i = 0; i < closes.length; i++) {
      if (tradeIdx < trades.length && !inPosition) {
        const trade = trades[tradeIdx];
        if (this.data[i].date.getTime() === trade.entryDate.getTime()) {
          inPosition = true;
          entryPrice = trade.entryPrice;
        }
      }

      if (inPosition) {
        const unrealizedPct = (closes[i] - entryPrice) / entryPrice;
        dailyEquity[i] = currentBalance * (1 + unrealizedPct);

        if (tradeIdx < trades.length) {
          const trade = trades[tradeIdx];
          if (this.data[i].date.getTime() === trade.exitDate.getTime()) {
            realizedProfits.push(currentBalance * (trade.profitPercent / 100));
            currentBalance *= 1 + trade.profitPercent / 100;
            dailyEquity[i] = currentBalance;
            inPosition = false;
            tradeIdx++;
          }
        }
      } else {
        dailyEquity[i] = currentBalance;
      }
    }

    const dailyReturns: number[] = [];
    for (let i = 1; i < dailyEquity.length; i++) {
      dailyReturns.push((dailyEquity[i] - dailyEquity[i - 1]) / dailyEquity[i - 1]);
    }

    const meanReturn = dailyReturns.reduce((a, b) => a + b, 0) / (dailyReturns.length || 1);
    const stdReturn = Math.sqrt(
      dailyReturns.map((x) => (x - meanReturn) ** 2).reduce((a, b) => a + b, 0) /
        (dailyReturns.length || 1)
    );
    const sharpe = stdReturn === 0 ? 0 : (meanReturn / stdReturn) * Math.sqrt(252);

    let peak = initialCapital;
    let maxDD = 0;
    for (const equity of dailyEquity) {
      if (equity > peak) peak = equity;
      const dd = (peak - equity) / peak;
      if (dd > maxDD) maxDD = dd;
    }

    const winTrades = trades.filter((t) => t.profit > 0);
    const winRate = trades.length > 0 ? (winTrades.length / trades.length) * 100 : 0;

    const grossProfit = realizedProfits
      .filter((profit) => profit > 0)
      .reduce((sum, profit) => sum + profit, 0);
    const grossLoss = Math.abs(
      realizedProfits.filter((profit) => profit <= 0).reduce((sum, profit) => sum + profit, 0)
    );
    const profitFactor =
      grossLoss === 0 ? (grossProfit > 0 ? Infinity : 0) : grossProfit / grossLoss;

    const finalBalance = dailyEquity[dailyEquity.length - 1] ?? initialCapital;
    const totalReturn = (finalBalance - initialCapital) / initialCapital;

    return {
      sharpeRatio: sharpe,
      maxDrawdown: maxDD * 100,
      winRate,
      totalTrades: trades.length,
      profitFactor,
      return: totalReturn,
    };
  }
}
