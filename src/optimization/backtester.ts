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
      const _prevClose = closes[i - 1]; // logic check

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

      // FearGreed mocked
      const fearGreed = 50;
      if (fearGreed < 40) buyScore += w.fearGreed;

      // Sell Logic
      if (rsiVal > 70) sellScore += w.rsi;
      if (stochVal.k > 80) sellScore += w.stochastic;
      if (currentClose >= bbVal.upper) sellScore += w.bollinger;
      if (currentClose >= donchUpperVal) sellScore += w.donchian;
      if (williamsVal > -20) sellScore += w.williamsR;
      if (macdVal.histogram && macdVal.histogram < 0) sellScore += w.macd;
      if (currentClose < smaVal) sellScore += w.sma;
      if (currentClose < emaVal) sellScore += w.ema;
      if (fearGreed > 60) sellScore += w.fearGreed;

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
    const _balance = initialCapital;
    const _maxBalance = initialCapital;
    const _drawdown = 0;

    // Simplistic daily return simulation using trades
    // To calculate Sharpe correctly, we need daily returns even when not trading?
    // Or trade-based Sharpe. I'll use trade-based statistics for simplicity,
    // or reconstruct equity curve.

    // Let's reconstruct equity curve
    // Note: This is an approximation since we jump between trades.
    // For rigorous Sharpe, we need daily mark-to-market.

    // Simplified: Just use trade returns.
    const returns = trades.map((t) => t.profitPercent / 100);
    const meanReturn = returns.reduce((a, b) => a + b, 0) / (returns.length || 1);
    const stdReturn = Math.sqrt(
      returns.map((x) => (x - meanReturn) ** 2).reduce((a, b) => a + b, 0) / (returns.length || 1)
    );
    const sharpe = stdReturn === 0 ? 0 : (meanReturn / stdReturn) * Math.sqrt(252); // Annualized? Trade-based is different.

    // For max drawdown
    let peak = initialCapital;
    let maxDD = 0;
    let currentBalance = initialCapital;

    for (const trade of trades) {
      // Assuming 100% equity usage per trade for simplicity (or fixed position size)
      // Python code: initial_capital=10000.
      // Let's assume full compounding.
      currentBalance *= 1 + trade.profitPercent / 100;
      if (currentBalance > peak) peak = currentBalance;
      const dd = (peak - currentBalance) / peak;
      if (dd > maxDD) maxDD = dd;
    }

    const winTrades = trades.filter((t) => t.profit > 0);
    const winRate = trades.length > 0 ? (winTrades.length / trades.length) * 100 : 0;

    const totalReturn = (currentBalance - initialCapital) / initialCapital;

    return {
      sharpeRatio: sharpe,
      maxDrawdown: maxDD * 100,
      winRate: winRate,
      totalTrades: trades.length,
      profitFactor: 0, // TODO
      return: totalReturn,
    };
  }
}
