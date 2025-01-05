import yahooFinance from 'yahoo-finance2';
import { stochastic, rsi } from 'technicalindicators';
import fs from 'node:fs';
import { DateTime } from 'luxon';
import pino from 'pino';

// ========================================================================
// 1. pino 로거 초기화
// ========================================================================
const logger = pino({
  level: 'debug', // 디버그까지 포함해서 자세히 보고 싶다면 'debug'
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: {
    target: 'pino-pretty'
  }
});

// ========================================================================
// 2. 설정
// ========================================================================
const TICKERS = ['TSLA', 'PLTR']; // 조회할 종목
const USDKRW_SYMBOL = 'USDKRW=X'; // 원/달러 환율
const CSV_FILE_NAME = 'stock_data.csv';

// ========================================================================
// 3. 야후 파이낸스 + 기술 지표 계산 함수들
// ========================================================================

/**
 * Luxon 사용: period1, period2를 daysAgo로부터 계산.
 * 야후 파이낸스 historical()을 통해 (최신→과거)로 오는 데이터를
 * 이 코드는 현재 reverse()를 제거하여 "API 반환 그대로" 쓰고 있음.
 */
async function getHistoricalPrices(
  symbol: string,
  daysAgo = 365,
  interval: '1d' | '1wk' = '1d'
) {
  const end = DateTime.now();
  const start = end.minus({ days: daysAgo });

  const period1 = start.toJSDate();
  const period2 = end.toJSDate();

  // 호출 파라미터 로그
  logger.debug(
    {
      symbol,
      interval,
      daysAgo,
      period1: period1.toISOString(),
      period2: period2.toISOString()
    },
    'Fetching historical data'
  );

  const result = await yahooFinance.historical(symbol, {
    period1,
    period2,
    interval,
    events: 'history',
    includeAdjustedClose: true
  });

  // 결과 요약 로그
  logger.debug(
    {
      length: result.length,
      firstItem: result[0],
      lastItem: result[result.length - 1]
    },
    'Fetched historical data result'
  );

  // API 반환값이 "최신→과거"인 상태라면,
  // 굳이 reverse() 호출하지 않고 그대로 반환
  return result;
}

/** 전고점 대비 dropPercent% 이상 하락했는지 (ex: 20% 이상 하락) */
function isPriceBelowPeak(prices: { close: number }[], dropPercent = 20): boolean {
  if (!prices || prices.length === 0) return false;

  const maxClose = Math.max(...prices.map((p) => p.close));
  const latestClose = prices[prices.length - 1].close;

  const threshold = (100 - dropPercent) / 100; // 예: 20% → 0.8

  logger.debug(
    {
      maxClose,
      latestClose,
      thresholdRatio: threshold,
      requiredDropPercent: dropPercent
    },
    'Checking if price is below peak'
  );

  return latestClose <= maxClose * threshold;
}

/** 주 단위 스토캐스틱(K) 특정 임계값 이하인지 (기본 40) */
function isStochUnder(
  weeklyData: { high: number; low: number; close: number }[],
  stochThreshold = 40,
  period = 14,
  signalPeriod = 3
): boolean {
  if (weeklyData.length < period) return false;

  const highs = weeklyData.map((d) => d.high);
  const lows = weeklyData.map((d) => d.low);
  const closes = weeklyData.map((d) => d.close);

  const stochResult = stochastic({
    high: highs,
    low: lows,
    close: closes,
    period,
    signalPeriod
  });
  if (!stochResult || stochResult.length === 0) return false;

  const latestStoch = stochResult[stochResult.length - 1];
  logger.debug(
    {
      stochThreshold,
      period,
      signalPeriod,
      latestK: latestStoch.k,
      latestD: latestStoch.d
    },
    'Checking if stoch < threshold'
  );

  return latestStoch.k <= stochThreshold;
}

/** 일 단위 RSI가 특정 임계값 이하인지 (기본 40) */
function isRsiUnder(dailyData: { close: number }[], rsiThreshold = 40, period = 14): boolean {
  if (dailyData.length < period) return false;

  const closes = dailyData.map((d) => d.close);
  const rsiValues = rsi({ values: closes, period });
  if (!rsiValues || rsiValues.length === 0) return false;

  const latestRsi = rsiValues[rsiValues.length - 1];
  logger.debug(
    {
      rsiThreshold,
      period,
      latestRsi
    },
    'Checking if RSI < threshold'
  );

  return latestRsi < rsiThreshold;
}

/** 원/달러 환율 조회 */
async function getUSDToKRWRate(): Promise<number> {
  const quote = await yahooFinance.quote(USDKRW_SYMBOL);
  if (!quote || !quote.regularMarketPrice) {
    throw new Error('원/달러 환율 조회 실패');
  }
  logger.debug({ usdkrw: quote.regularMarketPrice }, 'Fetched USD/KRW rate');
  return quote.regularMarketPrice;
}

// ========================================================================
// 4. 메인 로직
// ========================================================================

async function processTicker(ticker: string) {
  logger.info({ ticker }, 'Processing ticker...');

  // 일봉(1년치), 주봉(1년치), 환율 병렬 조회
  const [dailyPrices, weeklyPrices, usdkrw] = await Promise.all([
    getHistoricalPrices(ticker, 365, '1d'),
    getHistoricalPrices(ticker, 365, '1wk'),
    getUSDToKRWRate()
  ]);

  if (dailyPrices.length === 0) {
    // 혹시 데이터가 전혀 없으면 조건 계산 불가
    logger.warn({ ticker }, 'No dailyPrices data found');
    return {
      ticker,
      date: 'N/A',
      close: 0,
      usdkrw,
      isFall20: false,
      isStochUnder40: false,
      isRsiUnder40: false
    };
  }

  const latestDaily = dailyPrices[dailyPrices.length - 1];

  const latestDateStr = latestDaily.date.toISOString().split('T')[0];

  // 조건 계산 (이름 변경: isFall20, isStochUnder40, isRsiUnder40)
  const isFall20 = isPriceBelowPeak(dailyPrices, 20);
  const isStochUnder40 = isStochUnder(weeklyPrices, 40);
  const isRsiUnder40 = isRsiUnder(dailyPrices, 40);

  logger.debug(
    {
      ticker,
      date: latestDateStr,
      close: latestDaily.close,
      isFall20,
      isStochUnder40,
      isRsiUnder40
    },
    'Calculated conditions for ticker'
  );

  return {
    ticker,
    date: latestDateStr,
    close: latestDaily.close,
    usdkrw,
    isFall20,
    isStochUnder40,
    isRsiUnder40
  };
}

async function fetchAndNotifyForTickers(tickers: string[]) {
  try {
    logger.info({ tickers }, 'Starting fetchAndNotifyForTickers');

    const results = await Promise.all(tickers.map((t) => processTicker(t)));

    // CSV 저장
    const validResults = results.filter((r) => r);
    await writeToCsv(validResults);

    // 조건 충족 종목 로그 출력
    const triggered = validResults.filter(
      (r) => r.isFall20 || r.isStochUnder40 || r.isRsiUnder40
    );
    if (triggered.length > 0) {
      logger.warn(
        { triggered },
        `Found ${triggered.length} tickers that meet the conditions!`
      );
      triggered.forEach((info) => {
        logger.warn(
          {
            ticker: info.ticker,
            date: info.date,
            close: info.close,
            usdkrw: info.usdkrw,
            isFall20: info.isFall20,
            isStochUnder40: info.isStochUnder40,
            isRsiUnder40: info.isRsiUnder40
          },
          'Ticker condition triggered'
        );
      });
    } else {
      logger.info('No tickers meet the condition.');
    }
  } catch (error) {
    logger.error({ error }, 'Error occurred in fetchAndNotifyForTickers');
  }
}

// ========================================================================
// 5. CSV 기록 (소숫점 2자리, 더 직관적인 컬럼명으로)
// ========================================================================
async function writeToCsv(
  data: {
    ticker: string;
    date: string;
    close: number;
    usdkrw: number;
    isFall20: boolean;
    isStochUnder40: boolean;
    isRsiUnder40: boolean;
  }[]
) {
  if (!data || data.length === 0) {
    logger.info('No data to write to CSV.');
    return;
  }

  const fileExists = fs.existsSync(CSV_FILE_NAME);

  const header = [
    'Date',
    'Ticker',
    'Close',
    'USD/KRW',
    'Fall20(전고점-20%)',
    'StochUnder40',
    'RsiUnder40'
  ].join(',');

  let csvContent = '';
  if (!fileExists) {
    csvContent += header + '\n';
  }

  data.forEach((item) => {
    // 소숫점 2자리까지 기록
    const closeStr = item.close.toFixed(2);
    const usdkrwStr = item.usdkrw.toFixed(2);

    const row = [
      item.date,
      item.ticker,
      closeStr,
      usdkrwStr,
      item.isFall20 ? 'Y' : 'N',
      item.isStochUnder40 ? 'Y' : 'N',
      item.isRsiUnder40 ? 'Y' : 'N'
    ].join(',');
    csvContent += row + '\n';
  });

  fs.appendFileSync(CSV_FILE_NAME, csvContent, { encoding: 'utf-8' });
  logger.info(`[CSV 기록 완료] ${CSV_FILE_NAME}`);
}

// ========================================================================
// 6. 실행
// ========================================================================
if (require.main === module) {
  (async () => {
    await fetchAndNotifyForTickers(TICKERS);
  })();
}
