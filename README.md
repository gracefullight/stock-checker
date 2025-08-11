# Multi-Ticker Stock Checker

This project fetches daily stock data for multiple tickers using `yahoo-finance2`, computes several technical indicators, and writes a dated CSV to the `public` directory.

## Indicators
- Close price & volume
- Relative Strength Index (RSI)
- Stochastic oscillator %K
- Bollinger Bands (20-day, 2 standard deviations)
- Donchian Channels (20-day)
- Williams %R (14-day)
- Fear & Greed Index (alternative.me)
- Derived BUY/HOLD opinion weighted by indicator reliability and basic pattern detection
- Basic detection of bullish chart patterns (ascending triangle, bullish flag, double bottom, falling wedge, island reversal)

## Usage
1. **Install & run**
   ```bash
   pnpm install
   pnpm start --ticker=TSLA,PLTR,IONQ,GEV,RXRX,DNA
   ```

   Pass any comma-separated list of tickers via `--ticker`. If omitted, the
   script exits with an error message. Argument parsing is handled by
   [commander](https://github.com/tj/commander.js).

Each run appends data to a file named `public/stock_data_YYYYMMDD.csv`.

A scheduled GitHub Action (`.github/workflows/daily-data.yml`) executes the script daily and commits new CSV files automatically.
