---
skill_id: financial_data_fetcher
name: Financial Data Fetcher
version: 1.0.0
description: Fetches real-time and historical market data, financial news, and fundamental data for trading decisions
author: Trading System CTO
tags: [market-data, trading, finance, real-time]
tools:
  - get_price_data
  - get_latest_news
  - get_fundamentals
  - get_market_snapshot
dependencies:
  - alpaca-trade-api
  - yfinance
  - requests
  - python-dotenv
---

# Financial Data Fetcher Skill

Provides comprehensive market data access for AI trading agents.

## Overview

This skill fetches:
- Real-time and historical OHLCV price data
- Financial news from multiple sources
- Fundamental data (P/E ratios, earnings, market cap)
- Market snapshots and quotes

## Tools

### 1. get_price_data

Fetches historical or real-time price data for symbols.

**Parameters:**
- `symbols` (required): List of ticker symbols (e.g., ["AAPL", "MSFT"])
- `timeframe` (optional): "1Min", "5Min", "1Hour", "1Day" (default: "1Day")
- `start_date` (optional): Start date in YYYY-MM-DD format
- `end_date` (optional): End date in YYYY-MM-DD format
- `limit` (optional): Number of bars to fetch (default: 100)

**Returns:**
```json
{
  "success": true,
  "data": {
    "AAPL": [
      {
        "timestamp": "2025-10-30T09:30:00Z",
        "open": 150.25,
        "high": 151.50,
        "low": 149.80,
        "close": 151.00,
        "volume": 5000000
      }
    ]
  }
}
```

**Usage:**
```bash
python scripts/fetch_data.py get_price_data --symbols AAPL MSFT --timeframe 1Day --limit 30
```

### 2. get_latest_news

Fetches recent financial news for symbols.

**Parameters:**
- `symbols` (required): List of ticker symbols
- `limit` (optional): Number of news items (default: 10)
- `sources` (optional): News sources to query (default: all)

**Returns:**
```json
{
  "success": true,
  "data": [
    {
      "symbol": "AAPL",
      "headline": "Apple announces new product line",
      "summary": "...",
      "source": "Bloomberg",
      "url": "https://...",
      "published_at": "2025-10-30T08:00:00Z",
      "sentiment": "positive"
    }
  ]
}
```

### 3. get_fundamentals

Fetches fundamental data for symbols.

**Parameters:**
- `symbols` (required): List of ticker symbols
- `metrics` (optional): Specific metrics to fetch (default: all)

**Returns:**
```json
{
  "success": true,
  "data": {
    "AAPL": {
      "market_cap": 3000000000000,
      "pe_ratio": 28.5,
      "eps": 6.42,
      "dividend_yield": 0.52,
      "beta": 1.2,
      "52_week_high": 200.00,
      "52_week_low": 120.00
    }
  }
}
```

### 4. get_market_snapshot

Gets current market snapshot with real-time quotes.

**Parameters:**
- `symbols` (required): List of ticker symbols

**Returns:**
```json
{
  "success": true,
  "data": {
    "AAPL": {
      "price": 151.00,
      "bid": 150.98,
      "ask": 151.02,
      "bid_size": 100,
      "ask_size": 200,
      "last_trade_time": "2025-10-30T15:59:59Z",
      "volume": 50000000,
      "vwap": 150.75
    }
  }
}
```

## Implementation

See `scripts/fetch_data.py` for full implementation using Alpaca API and yfinance.

## Rate Limiting

- Alpaca API: 200 requests/minute
- News API: 25 requests/day (free tier)
- Caching: 5-minute cache for real-time data

## Error Handling

All tools return consistent error format:
```json
{
  "success": false,
  "error": "Error message",
  "error_code": "INVALID_SYMBOL"
}
```

## Integration Example

```python
from claude_skills import load_skill

skill = load_skill("financial_data_fetcher")

# Get price data
result = skill.get_price_data(
    symbols=["AAPL", "MSFT"],
    timeframe="1Day",
    limit=30
)

if result["success"]:
    prices = result["data"]
    # Use in trading strategy
```
