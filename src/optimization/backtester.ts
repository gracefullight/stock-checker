import {
  BollingerBands,
  EMA,
  MACD,
  RSI,
  SMA,
  Stochastic,
  WilliamsR,
} from 'technicalindicators';
import type { BacktestMetrics } from '@/optimization/types';
import type { CandleData, IndicatorValues, PipelineConfig } from '@/types';
import { detectPatterns } from '@/services/patterns';
import { evaluateSignal } from '@/services/pipeline';

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

  public run(params: PipelineConfig, initialCapital = 10000): BacktestMetrics {
    const signals = this.generateSignals(params);
    const trades = this.simulateTrades(signals);
    return this.calculateMetrics(trades, initialCapital);
  }

  private generateSignals(params: PipelineConfig): ('BUY' | 'SELL' | 'HOLD')[] {
    const closes = this.data.map((d) => d.close);
    const highs = this.data.map((d) => d.high);
    const lows = this.data.map((d) => d.low);
    const volumes = this.data.map((d) => d.volume);

    // Pre-compute all indicator arrays once
    const rsiArr = RSI.calculate({ values: closes, period: 14 });
    const stochArr = Stochastic.calculate({
      high: highs,
      low: lows,
      close: closes,
      period: 14,
      signalPeriod: 3,
    });
    const bbArr = BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });
    const macdArr = MACD.calculate({
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: true,
      SimpleMASignal: true,
    });
    const sma20Arr = SMA.calculate({ values: closes, period: 20 });
    const ema20Arr = EMA.calculate({ values: closes, period: 20 });
    const sma50Arr = SMA.calculate({ values: closes, period: 50 });
    const sma200Arr = SMA.calculate({ values: closes, period: 200 });
    const williamsArr = WilliamsR.calculate({
      high: highs,
      low: lows,
      close: closes,
      period: 14,
    });

    // Pre-compute ATR
    const atrPeriod = 14;
    const atrArr: number[] = [];
    for (let i = 0; i < closes.length; i++) {
      if (i < atrPeriod) {
        atrArr.push(0);
        continue;
      }
      let sum = 0;
      for (let j = i - atrPeriod + 1; j <= i; j++) {
        const tr = Math.max(
          highs[j] - lows[j],
          Math.abs(highs[j] - closes[j - 1]),
          Math.abs(lows[j] - closes[j - 1]),
        );
        sum += tr;
      }
      atrArr.push(sum / atrPeriod);
    }

    // Pre-compute Donchian channels
    const donchPeriod = 20;
    const donchLowerArr: number[] = [];
    const donchUpperArr: number[] = [];
    for (let i = 0; i < closes.length; i++) {
      if (i < donchPeriod) {
        donchLowerArr.push(lows[i]);
        donchUpperArr.push(highs[i]);
        continue;
      }
      donchLowerArr.push(Math.min(...lows.slice(i - donchPeriod, i)));
      donchUpperArr.push(Math.max(...highs.slice(i - donchPeriod, i)));
    }

    // Pre-compute volume moving average
    const volMaArr: number[] = [];
    for (let i = 0; i < volumes.length; i++) {
      if (i < 20) {
        volMaArr.push(volumes[i] || 1);
        continue;
      }
      volMaArr.push(volumes.slice(i - 20, i).reduce((a, b) => a + b, 0) / 20);
    }

    // Extract MACD histogram array
    const macdHistArr = macdArr.map((m) => {
      const macdVal = (m as { MACD?: number }).MACD ?? 0;
      const sigVal = (m as { signal?: number }).signal ?? 0;
      return macdVal - sigVal;
    });

    const signals: ('BUY' | 'SELL' | 'HOLD')[] = new Array(closes.length).fill('HOLD');
    const recentBuyDates: Date[] = [];

    // Start at 200 to ensure SMA200 is available
    const startIdx = Math.max(200, 50);
    for (let i = startIdx; i < closes.length; i++) {
      const rsiVal = rsiArr[i - 14];
      const stochVal = stochArr[i - 14];
      const bbVal = bbArr[i - 20];
      const sma20Val = sma20Arr[i - 20];
      const ema20Val = ema20Arr[i - 20];
      const sma50Val = sma50Arr[i - 50];
      const sma200Val = sma200Arr[i - 200];
      const williamsVal = williamsArr[i - 14];

      if (rsiVal == null || stochVal == null || bbVal == null || sma20Val == null || ema20Val == null) {
        continue;
      }

      const indicators: IndicatorValues = {
        rsi: rsiVal,
        stochasticK: stochVal.k,
        bbLower: bbVal.lower,
        bbUpper: bbVal.upper,
        donchLower: donchLowerArr[i],
        donchUpper: donchUpperArr[i],
        williamsR: williamsVal ?? -50,
        atr: atrArr[i],
        macd: 0,
        macdSignal: 0,
        macdHistogram: macdHistArr[i - 26] ?? 0,
        sma20: sma20Val,
        ema20: ema20Val,
        sma50: sma50Val ?? NaN,
        sma200: sma200Val ?? NaN,
        volumeRatio: volMaArr[i] > 0 ? volumes[i] / volMaArr[i] : 1.0,
      };

      // Recent candles for reversal confirmation
      const recentCandles: CandleData[] = [];
      for (let j = Math.max(0, i - 2); j <= i; j++) {
        recentCandles.push({
          open: this.data[j].open,
          close: this.data[j].close,
          high: this.data[j].high,
          low: this.data[j].low,
          volume: this.data[j].volume,
        });
      }

      // Recent MACD histogram for crossover detection
      const histStart = Math.max(0, (i - 26) - 4);
      const histEnd = i - 26 + 1;
      const recentMacdHistogram =
        histEnd > 0 ? macdHistArr.slice(histStart, histEnd) : [0];

      // Detect chart patterns from recent price window
      const patternWindow = Math.min(i + 1, 50);
      const patternHighs = highs.slice(i - patternWindow + 1, i + 1);
      const patternLows = lows.slice(i - patternWindow + 1, i + 1);
      const patternCloses = closes.slice(i - patternWindow + 1, i + 1);
      const { score: patternScore } = detectPatterns(
        { highs: patternHighs, lows: patternLows, closes: patternCloses },
        params.patternWeights,
      );

      const result = evaluateSignal({
        ticker: 'BACKTEST',
        indicators,
        close: closes[i],
        open: this.data[i].open,
        fearGreed: null,
        patternScore,
        recentCandles,
        recentMacdHistogram,
        config: params,
        recentBuyDates,
        currentDate: this.data[i].date,
      });

      signals[i] = result.finalDecision;
      if (result.finalDecision === 'BUY') {
        recentBuyDates.push(this.data[i].date);
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
        const profit = price - position.price;
        const profitPercent = (profit / position.price) * 100;
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
      const profit = price - position.price;
      const profitPercent = (profit / position.price) * 100;
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

    const dailyReturns: number[] = [];
    for (let i = 1; i < dailyEquity.length; i++) {
      dailyReturns.push((dailyEquity[i] - dailyEquity[i - 1]) / dailyEquity[i - 1]);
    }

    const meanReturn = dailyReturns.reduce((a, b) => a + b, 0) / (dailyReturns.length || 1);
    const stdReturn = Math.sqrt(
      dailyReturns.map((x) => (x - meanReturn) ** 2).reduce((a, b) => a + b, 0) /
        (dailyReturns.length || 1),
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
    const loseTrades = trades.filter((t) => t.profit <= 0);
    const winRate = trades.length > 0 ? (winTrades.length / trades.length) * 100 : 0;

    const grossProfit = winTrades.reduce((sum, t) => sum + t.profit, 0);
    const grossLoss = Math.abs(loseTrades.reduce((sum, t) => sum + t.profit, 0));
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
