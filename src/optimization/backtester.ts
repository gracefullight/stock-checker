import { BollingerBands, EMA, MACD, RSI, SMA, Stochastic, WilliamsR } from 'technicalindicators';
import type { BacktestMetrics, OptimizationParams } from '@/optimization/types';

interface Candle {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjClose?: number;
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

export class Backtester {
  private data: Candle[];

  constructor(data: Candle[]) {
    this.data = data;
  }

  public run(params: OptimizationParams, initialCapital = 10000): BacktestMetrics {
    const signals = this.generateSignals(params);
    const trades = this.simulateTrades(signals);
    return this.calculateMetrics(trades, initialCapital);
  }

  private generateSignals(params: OptimizationParams): ('BUY' | 'SELL' | 'HOLD')[] {
    const closes = this.data.map((d) => d.close);
    const highs = this.data.map((d) => d.high);
    const lows = this.data.map((d) => d.low);

    // Calculate Indicators
    const rsi = RSI.calculate({ values: closes, period: 14 });
    const stoch = Stochastic.calculate({
      high: highs,
      low: lows,
      close: closes,
      period: 14,
      signalPeriod: 3,
    });
    const bb = BollingerBands.calculate({
      values: closes,
      period: 20,
      stdDev: 2,
    });
    const macd = MACD.calculate({
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });
    const sma20 = SMA.calculate({ values: closes, period: 20 });
    const ema20 = EMA.calculate({ values: closes, period: 20 });
    const williams = WilliamsR.calculate({
      high: highs,
      low: lows,
      close: closes,
      period: 14,
    });

    // Donchian Channels (Manual implementation as it might be missing or different)
    const donchianLower = [];
    const donchianUpper = [];
    for (let i = 0; i < closes.length; i++) {
      if (i < 20) {
        donchianLower.push(lows[i]);
        donchianUpper.push(highs[i]);
        continue;
      }
      const sliceLow = lows.slice(i - 20, i);
      const sliceHigh = highs.slice(i - 20, i);
      donchianLower.push(Math.min(...sliceLow));
      donchianUpper.push(Math.max(...sliceHigh));
    }

    const signals: ('BUY' | 'SELL' | 'HOLD')[] = new Array(closes.length).fill('HOLD');

    // Align arrays (indicators have separate lengths due to lookback)
    // We iterate backwards or carefully handle indices.
    // Simplest is to map by index, handling undefined.

    for (let i = 50; i < closes.length; i++) {
      const currentClose = closes[i];

      // Get values matching current index 'i'
      // Note: `technicalindicators` results often start after 'period' elements.
      // E.g. RSI(14) result[0] corresponds to input[14].
      // We need to shift indices correctly.

      const rsiVal = rsi[i - 14];
      const stochVal = stoch[i - 14]; // {k, d}
      const bbVal = bb[i - 20]; // {lower, middle, upper}
      const macdVal = macd[i - 26]; // {MACD, signal, histogram}
      const smaVal = sma20[i - 20];
      const emaVal = ema20[i - 20];
      const williamsVal = williams[i - 14];
      const donchLowerVal = donchianLower[i];
      const donchUpperVal = donchianUpper[i];

      if (!rsiVal || !stochVal || !bbVal || !macdVal || !smaVal || !emaVal || !williamsVal)
        continue;

      let buyScore = 0;
      let sellScore = 0;
      const w = params.indicatorWeights;

      // Buy Logic
      if (rsiVal < 30) buyScore += w.rsi;
      if (stochVal.k < 20) buyScore += w.stochastic;
      if (currentClose <= bbVal.lower) buyScore += w.bollinger;
      if (currentClose <= donchLowerVal) buyScore += w.donchian;
      if (williamsVal < -80) buyScore += w.williamsR;
      if (macdVal.histogram && macdVal.histogram > 0) buyScore += w.macd;
      if (currentClose > smaVal) buyScore += w.sma;
      if (currentClose > emaVal) buyScore += w.ema;

      // Sell Logic
      if (rsiVal > 70) sellScore += w.rsi;
      if (stochVal.k > 80) sellScore += w.stochastic;
      if (currentClose >= bbVal.upper) sellScore += w.bollinger;
      if (currentClose >= donchUpperVal) sellScore += w.donchian;
      if (williamsVal > -20) sellScore += w.williamsR;
      if (macdVal.histogram && macdVal.histogram < 0) sellScore += w.macd;
      if (currentClose < smaVal) sellScore += w.sma;
      if (currentClose < emaVal) sellScore += w.ema;

      const t = params.thresholds;

      if (buyScore >= t.buy && buyScore >= sellScore) {
        signals[i] = 'BUY';
      } else if (sellScore >= t.sell && sellScore > buyScore) {
        signals[i] = 'SELL';
      }
    }

    return signals;
  }

  private simulateTrades(signals: ('BUY' | 'SELL' | 'HOLD')[]): Trade[] {
    const trades: Trade[] = [];
    let position: { price: number; date: Date } | null = null;
    const closes = this.data.map((d) => d.close);
    const dates = this.data.map((d) => d.date);

    for (let i = 0; i < signals.length; i++) {
      const signal = signals[i];
      const price = closes[i];
      const date = dates[i];

      if (position && signal === 'SELL') {
        const profit = price - position.price; // Long only for now
        const profitPercent = (profit / position.price) * 100;
        trades.push({
          entryDate: position.date,
          exitDate: date,
          entryPrice: position.price,
          exitPrice: price,
          direction: 'long',
          profit: profit,
          profitPercent: profitPercent,
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
      const profit = price - position.price;
      const profitPercent = (profit / position.price) * 100;
      trades.push({
        entryDate: position.date,
        exitDate: date,
        entryPrice: position.price,
        exitPrice: price,
        direction: 'long',
        profit: profit,
        profitPercent: profitPercent,
      });
    }

    return trades;
  }

  private calculateMetrics(trades: Trade[], initialCapital: number): BacktestMetrics {
    // Build daily equity curve for proper Sharpe calculation
    const closes = this.data.map((d) => d.close);
    const dailyEquity: number[] = new Array(closes.length).fill(initialCapital);
    let currentBalance = initialCapital;
    let inPosition = false;
    let entryPrice = 0;

    // Reconstruct daily equity from trades
    let tradeIdx = 0;
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
            currentBalance *= 1 + trade.profitPercent / 100;
            inPosition = false;
            tradeIdx++;
          }
        }
      } else {
        dailyEquity[i] = currentBalance;
      }
    }

    // Daily returns from equity curve
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

    // Max drawdown from equity curve
    let peak = initialCapital;
    let maxDD = 0;
    for (const equity of dailyEquity) {
      if (equity > peak) peak = equity;
      const dd = (peak - equity) / peak;
      if (dd > maxDD) maxDD = dd;
    }

    const winTrades = trades.filter((t) => t.profit > 0);
    const loseTrades = trades.filter((t) => t.profit <= 0);
    const winRate = trades.length > 0 ? (winTrades.length / trades.length) * 100 : 0;

    const grossProfit = winTrades.reduce((sum, t) => sum + t.profit, 0);
    const grossLoss = Math.abs(loseTrades.reduce((sum, t) => sum + t.profit, 0));
    const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? Infinity : 0) : grossProfit / grossLoss;

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
