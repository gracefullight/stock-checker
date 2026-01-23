# Stock Checker Project Overview

## Purpose
Multi-ticker stock analysis tool that fetches daily stock data, computes technical indicators, detects chart patterns, and generates BUY/SELL/HOLD opinions with stop-loss/take-profit recommendations.

## Tech Stack
- **Language**: TypeScript with `strict: true`, CommonJS modules
- **Runtime**: Node.js 22
- **Package Manager**: pnpm
- **Key Dependencies**:
  - `yahoo-finance2`: Stock data fetching
  - `technicalindicators`: Technical indicators (RSI, Stochastic, Bollinger Bands, Williams %R, ATR)
  - `luxon`: Date/time handling
  - `pino`: Structured logging
  - `commander`: CLI argument parsing
  - `es-toolkit`: Utility functions (orderBy)
  - `pino-pretty`: Pretty log output

## Core Features
1. **Data Fetching**: Historical prices from Yahoo Finance API
2. **Technical Indicators**: RSI, Stochastic %K, Bollinger Bands, Donchian Channels, Williams %R, ATR
3. **Pattern Detection**: Ascending Triangle, Bullish Flag, Double Bottom, Falling Wedge, Island Reversal
4. **Market Sentiment**: Fear & Greed Index from alternative.me
5. **Trading Signals**: Weighted scoring system with configurable thresholds (default: 200 points)
6. **Risk Management**: ATR-based stop-loss, take-profit, and trailing stop calculations
7. **Output**: Daily CSV files in `public/` directory
8. **Notifications**: Slack webhooks for actionable signals (BUY/SELL)
9. **Automation**: GitHub Actions daily scheduler

## Architecture
- **Single-file CLI**: `src/index.ts` contains all logic
- **Functional Design**: Helper functions for indicator calculations, pattern detection, opinion generation
- **Async/Await**: Promise-based operations with parallel ticker processing
- **Error Handling**: Graceful failure handling with pino logging

## Project Status
- **Maturity**: Early stage (no tests yet)
- **Testing**: None (vitest recommended per AGENTS.md)
- **CI/CD**: GitHub Actions workflow for daily execution
