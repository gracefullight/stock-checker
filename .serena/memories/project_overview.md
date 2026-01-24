# Project Overview

## Description
Multi-Ticker Stock Checker is a TypeScript-based application that fetches daily stock data for multiple tickers using `yahoo-finance2`. It computes technical indicators (RSI, MACD, Bollinger Bands, etc.) and generates investment reports.

## Features
- Fetches daily stock data for multiple tickers.
- Computes technical indicators:
  - RSI, MACD, Bollinger Bands, Donchian Channels, Williams %R.
  - Fear & Greed Index.
- Generates BUY/HOLD/SELL opinions.
- Detects bullish chart patterns.
- Supports Slack notifications via webhooks.
- Saves data to CSV files in `public/`.
- Automated via GitHub Actions.

## Tech Stack
- **Language**: TypeScript
- **Runtime**: Bun / Node.js 24
- **Key Libraries**:
  - `yahoo-finance2`: Financial data
  - `technicalindicators`: Technical analysis
  - `commander`: CLI interface
  - `luxon`: Date/time handling
  - `pino`: Logging
  - `vitest`: Testing
  - `biome`: Linting and Formatting

## Project Structure
- `src/`: Source code
  - `services/`: Core logic (data fetching, analysis)
  - `indicators/`: Technical indicators
  - `reports/`: Notification and reporting
  - `utils/`: Helpers
  - `types/`: Type definitions
  - `__tests__`: Tests
- `scripts/`: Helper scripts (optimize, learn)
- `public/`: Output directory
- `.github/workflows/`: CI/CD configuration
