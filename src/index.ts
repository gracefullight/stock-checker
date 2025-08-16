import yahooFinance from 'yahoo-finance2';
import { rsi, stochastic, bollingerbands, williamsr, atr } from 'technicalindicators';
import fs from 'node:fs';
import path from 'node:path';
import { DateTime } from 'luxon';
import pino from 'pino';
import { Command } from 'commander';

// =============================================================================
// Logger configuration
// =============================================================================
const logger = pino({
  level: 'debug',
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: { target: 'pino-pretty' }
});

// =============================================================================
// Settings
// =============================================================================
const CSV_DIR = 'public';

const INDICATOR_WEIGHTS = {
  rsi: 79,
  stochastic: 76,
  bollinger: 78,
  donchian: 74,
  williamsR: 72,
  fearGreed: 50
};

const PATTERN_WEIGHTS = {
  ascendingTriangle: 75,
  bullishFlag: 75,
  doubleBottom: 70,
  fallingWedge: 70,
  islandReversal: 73
};

// With individual indicators weighted ~70-80 points, a 200 score forces
// at least three strong signals to align before issuing a BUY or SELL. Tune as needed.
const BUY_THRESHOLD = 200;
const SELL_THRESHOLD = 200;

// =============================================================================
// Argument parsing
// =============================================================================
interface CliOptions {
  tickers: string[];
  slackWebhook?: string;
}

function parseOptions(): CliOptions {
  const program = new Command();
  program
    .option('--ticker <list>', 'Comma-separated tickers')
    .option('--slack-webhook <url>', 'Slack webhook URL');
  program.parse(process.argv);

  const opts = program.opts<{ ticker?: string; slackWebhook?: string }>();
  const rawTickers = process.env.npm_config_ticker ?? opts.ticker;

  if (!rawTickers) {
    logger.error('Ticker argument is required. Use --ticker=TSLA,PLTR');
    process.exit(1);
  }

  const tickers = rawTickers.split(',').map((t) => t.trim()).filter(Boolean);
  const slackWebhook =
    process.env.SLACK_WEBHOOK_URL ??
    (process.env.npm_config_slack_webhook as string | undefined) ??
    opts.slackWebhook;

  return { tickers, slackWebhook };
}

interface TickerResult {
  ticker: string;
  date: string;
  close: number;
  volume: number;
  rsi: number;
  stochasticK: number;
  bbLower: number;
  bbUpper: number;
  donchLower: number;
  donchUpper: number;
  williamsR: number;
  fearGreed: number | null;
  patterns: string[];
  score: number;
  opinion: string;
  atr: number;
  stopLoss: number;
  takeProfit: number;
  trailingStop: number;
  trailingStart: number;
}

// =============================================================================
// Data fetch helpers
// =============================================================================
async function getHistoricalPrices(symbol: string, daysAgo = 365) {
  const end = DateTime.now();
  const start = end.minus({ days: daysAgo });
  return yahooFinance.historical(symbol, {
    period1: start.toJSDate(),
    period2: end.toJSDate(),
    interval: '1d',
    events: 'history',
    includeAdjustedClose: true
  });
}

async function getFearGreedIndex(): Promise<number | null> {
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=1&format=json');
    const json = await res.json();
    const value = parseInt(json?.data?.[0]?.value, 10);
    return Number.isNaN(value) ? null : value;
  } catch (error) {
    logger.error({ error }, 'Failed to fetch fear/greed index');
    return null;
  }
}

function isAscendingTriangle(highs: number[], lows: number[]): boolean {
  const recentHighs = highs.slice(-5);
  const recentLows = lows.slice(-5);
  if (recentHighs.length < 5) return false;
  const maxHigh = Math.max(...recentHighs);
  const minHigh = Math.min(...recentHighs);
  const flatTop = (maxHigh - minHigh) / maxHigh < 0.01;
  const risingLows = recentLows.every((v, i, arr) => i === 0 || v >= arr[i - 1]);
  return flatTop && risingLows;
}

function isBullishFlag(closes: number[]): boolean {
  const recent = closes.slice(-10);
  if (recent.length < 10) return false;
  const first = recent[0];
  const max = Math.max(...recent);
  const min = Math.min(...recent);
  const strongUp = (max - first) / first > 0.05;
  const tightRange = (max - min) / max < 0.05;
  return strongUp && tightRange;
}

function isDoubleBottom(lows: number[]): boolean {
  const recent = lows.slice(-20);
  if (recent.length < 20) return false;
  const firstMin = Math.min(...recent.slice(0, 10));
  const secondMin = Math.min(...recent.slice(10));
  const diff = Math.abs(firstMin - secondMin) / ((firstMin + secondMin) / 2);
  return diff < 0.02;
}

function isFallingWedge(highs: number[], lows: number[]): boolean {
  const recentHighs = highs.slice(-6);
  const recentLows = lows.slice(-6);
  if (recentHighs.length < 6) return false;
  const lowerHighs = recentHighs.every((v, i, arr) => i === 0 || v < arr[i - 1]);
  const lowerLows = recentLows.every((v, i, arr) => i === 0 || v < arr[i - 1]);
  const highSlope = recentHighs[0] - recentHighs[recentHighs.length - 1];
  const lowSlope = recentLows[0] - recentLows[recentLows.length - 1];
  return lowerHighs && lowerLows && highSlope > lowSlope;
}

function isIslandReversal(closes: number[]): boolean {
  const recent = closes.slice(-5);
  if (recent.length < 5) return false;
  const gapDown = recent[1] < recent[0] * 0.95;
  const gapUp = recent[3] > recent[2] * 1.05;
  return gapDown && gapUp;
}

function detectBullishPatterns(highs: number[], lows: number[], closes: number[]): { score: number; patterns: string[] } {
  let score = 0;
  const patterns: string[] = [];
  if (isAscendingTriangle(highs, lows)) {
    score += PATTERN_WEIGHTS.ascendingTriangle;
    patterns.push('AscendingTriangle');
  }
  if (isBullishFlag(closes)) {
    score += PATTERN_WEIGHTS.bullishFlag;
    patterns.push('BullishFlag');
  }
  if (isDoubleBottom(lows)) {
    score += PATTERN_WEIGHTS.doubleBottom;
    patterns.push('DoubleBottom');
  }
  if (isFallingWedge(highs, lows)) {
    score += PATTERN_WEIGHTS.fallingWedge;
    patterns.push('FallingWedge');
  }
  if (isIslandReversal(closes)) {
    score += PATTERN_WEIGHTS.islandReversal;
    patterns.push('IslandReversal');
  }
  return { score, patterns };
}

function getOpinion(params: {
  rsi: number;
  stochasticK: number;
  williamsR: number;
  close: number;
  bbLower: number;
  bbUpper: number;
  donchLower: number;
  donchUpper: number;
  fearGreed: number | null;
  patternScore: number;
}): { decision: string; score: number } {
  const {
    rsi,
    stochasticK,
    williamsR,
    close,
    bbLower,
    bbUpper,
    donchLower,
    donchUpper,
    fearGreed,
    patternScore
  } = params;

  let buyScore = 0;
  if (rsi < 30) buyScore += INDICATOR_WEIGHTS.rsi;
  if (stochasticK < 20) buyScore += INDICATOR_WEIGHTS.stochastic;
  if (close <= bbLower) buyScore += INDICATOR_WEIGHTS.bollinger;
  if (close <= donchLower) buyScore += INDICATOR_WEIGHTS.donchian;
  if (williamsR < -80) buyScore += INDICATOR_WEIGHTS.williamsR;
  if ((fearGreed ?? 0) < 40) buyScore += INDICATOR_WEIGHTS.fearGreed;
  buyScore += patternScore;

  let sellScore = 0;
  if (rsi > 70) sellScore += INDICATOR_WEIGHTS.rsi;
  if (stochasticK > 80) sellScore += INDICATOR_WEIGHTS.stochastic;
  if (close >= bbUpper) sellScore += INDICATOR_WEIGHTS.bollinger;
  if (close >= donchUpper) sellScore += INDICATOR_WEIGHTS.donchian;
  if (williamsR > -20) sellScore += INDICATOR_WEIGHTS.williamsR;
  if ((fearGreed ?? 0) > 60) sellScore += INDICATOR_WEIGHTS.fearGreed;

  if (buyScore >= BUY_THRESHOLD && buyScore >= sellScore) {
    return { decision: 'BUY', score: buyScore };
  }
  if (sellScore >= SELL_THRESHOLD && sellScore > buyScore) {
    return { decision: 'SELL', score: sellScore };
  }
  return { decision: 'HOLD', score: Math.max(buyScore, sellScore) };
}

// =============================================================================
// Core processing
// =============================================================================
async function processTicker(ticker: string, fearGreed: number | null): Promise<TickerResult | null> {
  logger.info({ ticker }, 'Processing ticker');
  const dailyPrices = await getHistoricalPrices(ticker, 365);
  if (dailyPrices.length === 0) {
    logger.warn({ ticker }, 'No price data');
    return null;
  }

  const latest = dailyPrices[dailyPrices.length - 1];
  const dateStr = latest.date.toISOString().split('T')[0];
  const closes = dailyPrices.map((d) => d.close);
  const highs = dailyPrices.map((d) => d.high);
  const lows = dailyPrices.map((d) => d.low);

  const rsiValues = rsi({ values: closes, period: 14 });
  const latestRsi = rsiValues[rsiValues.length - 1];

  const stochValues = stochastic({ high: highs, low: lows, close: closes, period: 14, signalPeriod: 3 });
  const latestStoch = stochValues[stochValues.length - 1];

  const bbValues = bollingerbands({ period: 20, values: closes, stdDev: 2 });
  const latestBb = bbValues[bbValues.length - 1];

  const williamsValues = williamsr({ high: highs, low: lows, close: closes, period: 14 });
  const latestWilliams = williamsValues[williamsValues.length - 1];

  const donchPeriod = 20;
  const recentHighs = highs.slice(-donchPeriod);
  const recentLows = lows.slice(-donchPeriod);
  const donchUpper = Math.max(...recentHighs);
  const donchLower = Math.min(...recentLows);
  const { score: patternScore, patterns } = detectBullishPatterns(highs, lows, closes);

  const atrValues = atr({ high: highs, low: lows, close: closes, period: 14 });
  const latestAtr = atrValues[atrValues.length - 1];

  const { decision, score } = getOpinion({
    rsi: latestRsi,
    stochasticK: latestStoch.k,
    williamsR: latestWilliams,
    close: latest.close,
    bbLower: latestBb.lower,
    bbUpper: latestBb.upper,
    donchLower,
    donchUpper,
    fearGreed,
    patternScore
  });

  const riskMult = 1.5;
  const rewardMult = 2;
  const trailingMult = 1.2;
  const trailingActivationMult = 0.5;

  const risk = latestAtr * riskMult;
  const reward = risk * rewardMult;
  const direction = decision === 'SELL' ? -1 : 1;
  const stopLoss = latest.close - risk * direction;
  const takeProfit = latest.close + reward * direction;

  const trailingCandidate = latest.close - trailingMult * latestAtr * direction;
  const trailingStop =
    direction === 1
      ? Math.min(stopLoss, trailingCandidate)
      : Math.max(stopLoss, trailingCandidate);
  const trailingStart =
    latest.close + trailingActivationMult * latestAtr * direction;

  return {
    ticker,
    date: dateStr,
    close: latest.close,
    volume: latest.volume,
    rsi: latestRsi,
    stochasticK: latestStoch.k,
    bbLower: latestBb.lower,
    bbUpper: latestBb.upper,
    donchLower,
    donchUpper,
    williamsR: latestWilliams,
    fearGreed,
    patterns,
    score,
    opinion: decision,
    atr: latestAtr,
    stopLoss,
    takeProfit,
    trailingStop,
    trailingStart
  };
}

async function postToSlack(item: TickerResult, webhook: string) {
  const lines = [
    `- Close: ${item.close.toFixed(2)}`,
    `- Volume: ${item.volume}`,
    `- RSI: ${item.rsi.toFixed(2)}`,
    `- StochK: ${item.stochasticK.toFixed(2)}`,
    `- Bollinger Bands: ${item.bbLower.toFixed(2)} - ${item.bbUpper.toFixed(2)}`,
    `- Donchian Channels: ${item.donchLower.toFixed(2)} - ${item.donchUpper.toFixed(2)}`,
    `- Williams %R: ${item.williamsR.toFixed(2)}`,
    `- Fear & Greed: ${item.fearGreed ?? 'N/A'}`,
    `- Patterns: ${item.patterns.length ? item.patterns.join(', ') : 'None'}`,
    `- Score: ${item.score.toFixed(2)}`,
    `- ATR: ${item.atr.toFixed(2)}`,
    `- Stop Loss: ${item.stopLoss.toFixed(2)}`,
    `- Take Profit: ${item.takeProfit.toFixed(2)}`,
    `- Trailing Stop: ${item.trailingStop.toFixed(2)}`,
    `- Trailing Start: ${item.trailingStart.toFixed(2)}`
  ];
  const text = `${item.date} ${item.ticker} ${item.opinion}\n${lines.join('\n')}`;
  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    if (!res.ok) {
      logger.error({ status: res.status, body: await res.text() }, 'Slack webhook failed');
    }
  } catch (err) {
    logger.error({ err }, 'Slack notification error');
  }
}

async function fetchAndWrite(tickers: string[], slackWebhook?: string) {
  const fearGreed = await getFearGreedIndex();
  const results = (
    await Promise.all(tickers.map((t) => processTicker(t, fearGreed)))
  ).filter((r): r is TickerResult => r !== null);
  await writeToCsv(results);

  if (slackWebhook) {
    const actionable = results.filter((r) => r.opinion === 'BUY' || r.opinion === 'SELL');
    await Promise.all(actionable.map((r) => postToSlack(r, slackWebhook)));
  }
}

// =============================================================================
// CSV writer
// =============================================================================
async function writeToCsv(data: TickerResult[]) {
  if (data.length === 0) {
    logger.info('No data to write to CSV');
    return;
  }

  const sorted = [...data].sort((a, b) => a.ticker.localeCompare(b.ticker));

  if (!fs.existsSync(CSV_DIR)) {
    fs.mkdirSync(CSV_DIR, { recursive: true });
  }
  const filePath = path.join(CSV_DIR, `stock_data_${DateTime.now().toFormat('yyyyLLdd')}.csv`);
  const fileExists = fs.existsSync(filePath);

  const header = [
    'Date',
    'Ticker',
    'Close',
    'Volume',
    'RSI',
    'StochK',
    'BBLower',
    'BBUpper',
    'DonchLower',
    'DonchUpper',
    'WilliamsR',
    'FearGreed',
    'Patterns',
    'Score',
    'Opinion',
    'ATR',
    'StopLoss',
    'TakeProfit',
    'TrailingStop',
    'TrailingStart'
  ].join(',');

  let csv = '';
  if (!fileExists) {
    csv += header + '\n';
  }

  sorted.forEach((item) => {
    const row = [
      item.date,
      item.ticker,
      item.close.toFixed(2),
      item.volume,
      item.rsi.toFixed(2),
      item.stochasticK.toFixed(2),
      item.bbLower.toFixed(2),
      item.bbUpper.toFixed(2),
      item.donchLower.toFixed(2),
      item.donchUpper.toFixed(2),
      item.williamsR.toFixed(2),
      item.fearGreed ?? '',
      item.patterns.join('|'),
      item.score.toFixed(2),
      item.opinion,
      item.atr.toFixed(2),
      item.stopLoss.toFixed(2),
      item.takeProfit.toFixed(2),
      item.trailingStop.toFixed(2),
      item.trailingStart.toFixed(2)
    ].join(',');
    csv += row + '\n';
  });

  fs.appendFileSync(filePath, csv, { encoding: 'utf-8' });
  logger.info(`[CSV written] ${filePath}`);
}

// =============================================================================
// Run
// =============================================================================
if (require.main === module) {
  const { tickers, slackWebhook } = parseOptions();
  fetchAndWrite(tickers, slackWebhook).catch((err) =>
    logger.error({ err }, 'Unexpected error')
  );
}

