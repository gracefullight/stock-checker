# Multi-Ticker Stock Checker

This project uses yahoo-finance2 to fetch historical stock data (daily/weekly) for multiple tickers, checks specific conditions (e.g., price down 20% from peak, weekly Stochastic below 40, daily RSI below 40), and logs results both to the console (via pino) and to a CSV file (stock_data.csv).

## Features

- Multiple Tickers
  - Define your tickers in an array. The script fetches and analyzes each one in parallel.
- Key Conditions
  - Price Down 20%: Checks if current price is 80% or less of its highest close (over the fetched period).
  - Weekly Stochastic < 40: Based on the weekly data.
  - Daily RSI < 40: Based on daily data.
- If any of these is true, the ticker is flagged.
