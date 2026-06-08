import pino from 'pino';
import yahooFinance from '@/services/yahoo-finance';

const logger = pino({
  level: 'debug',
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: { target: 'pino-pretty' },
});

export interface OptionContract {
  contractSymbol: string;
  strike: number;
  lastPrice: number;
  change: number;
  percentChange: number;
  volume: number;
  openInterest: number;
  bid: number;
  ask: number;
  impliedVolatility: number;
  inTheMoney: boolean;
  currency: string;
}

export interface OptionsExpiration {
  expirationDate: Date;
  calls: OptionContract[];
  puts: OptionContract[];
}

export interface OptionsChainData {
  ticker: string;
  expirationDates: Date[];
  strikes: number[];
  options: OptionsExpiration[];
  underlyingPrice: number | null;
  currency: string | null;
}

interface RawOption {
  contractSymbol: string;
  strike: number;
  lastPrice: number;
  change: number;
  percentChange: number;
  volume: number;
  openInterest: number;
  bid: number;
  ask: number;
  impliedVolatility: number;
  inTheMoney: boolean;
  currency: string;
}

interface RawOptionExp {
  expirationDate: string | Date;
  calls: RawOption[];
  puts: RawOption[];
}

export async function getOptionsChain(
  ticker: string,
  expirationDate?: Date
): Promise<OptionsChainData> {
  try {
    const queryOptions = expirationDate
      ? { date: expirationDate, formatted: false, lang: 'en-US', region: 'US' }
      : { formatted: false, lang: 'en-US', region: 'US' };

    const result = await yahooFinance.options(ticker, queryOptions);

    const underlyingPrice = result.quote?.regularMarketPrice ?? null;
    const currency = result.quote?.currency ?? null;

    const options: OptionsExpiration[] = ((result.options || []) as unknown as RawOptionExp[]).map(
      (exp) => ({
        expirationDate: new Date(exp.expirationDate),
        calls: (exp.calls || []).map((call) => ({
          contractSymbol: call.contractSymbol,
          strike: call.strike,
          lastPrice: call.lastPrice,
          change: call.change,
          percentChange: call.percentChange,
          volume: call.volume,
          openInterest: call.openInterest,
          bid: call.bid,
          ask: call.ask,
          impliedVolatility: call.impliedVolatility,
          inTheMoney: call.inTheMoney,
          currency: call.currency,
        })),
        puts: (exp.puts || []).map((put) => ({
          contractSymbol: put.contractSymbol,
          strike: put.strike,
          lastPrice: put.lastPrice,
          change: put.change,
          percentChange: put.percentChange,
          volume: put.volume,
          openInterest: put.openInterest,
          bid: put.bid,
          ask: put.ask,
          impliedVolatility: put.impliedVolatility,
          inTheMoney: put.inTheMoney,
          currency: put.currency,
        })),
      })
    );

    const expirationDates = (result.expirationDates || []).map(
      (d: unknown) => new Date(d as string | number | Date)
    );

    return {
      ticker,
      expirationDates,
      strikes: result.strikes || [],
      options,
      underlyingPrice,
      currency,
    };
  } catch (error) {
    logger.error({ error, ticker }, 'Failed to fetch options chain');
    return {
      ticker,
      expirationDates: [],
      strikes: [],
      options: [],
      underlyingPrice: null,
      currency: null,
    };
  }
}

export async function getAtTheMoneyOptions(
  ticker: string,
  strikeThreshold = 5
): Promise<{ calls: OptionContract[]; puts: OptionContract[]; underlyingPrice: number | null }> {
  const optionsData = await getOptionsChain(ticker);
  const { underlyingPrice, options } = optionsData;

  if (underlyingPrice === null) {
    return { calls: [], puts: [], underlyingPrice: null };
  }

  const allCalls: OptionContract[] = [];
  const allPuts: OptionContract[] = [];

  for (const expiration of options) {
    const atmCalls = expiration.calls.filter(
      (call) => Math.abs(call.strike - underlyingPrice) < strikeThreshold
    );
    const atmPuts = expiration.puts.filter(
      (put) => Math.abs(put.strike - underlyingPrice) < strikeThreshold
    );

    allCalls.push(...atmCalls);
    allPuts.push(...atmPuts);
  }

  return { calls: allCalls, puts: allPuts, underlyingPrice };
}

export function formatOptionsData(data: OptionsChainData): string {
  const lines: string[] = [];

  lines.push(`\n=== Options Chain for ${data.ticker} ===`);

  if (data.underlyingPrice) {
    lines.push(`Underlying Price: ${data.underlyingPrice.toFixed(2)} ${data.currency || ''}`);
  }

  lines.push(`\nExpiration Dates: ${data.expirationDates.length} available`);
  data.expirationDates.slice(0, 5).forEach((date) => {
    lines.push(`  - ${date.toISOString().split('T')[0]}`);
  });
  if (data.expirationDates.length > 5) {
    lines.push(`  ... and ${data.expirationDates.length - 5} more`);
  }

  if (data.options.length > 0) {
    const nearestExpiration = data.options[0];
    lines.push(
      `\nNearest Expiration: ${nearestExpiration.expirationDate.toISOString().split('T')[0]}`
    );

    if (nearestExpiration.calls.length > 0) {
      lines.push('\nTop 5 Calls by Volume:');
      const topCalls = [...nearestExpiration.calls].sort((a, b) => b.volume - a.volume).slice(0, 5);
      topCalls.forEach((call) => {
        lines.push(
          `  Strike: ${call.strike.toFixed(2)} | Price: $${call.lastPrice.toFixed(2)} | Vol: ${call.volume} | OI: ${call.openInterest} | IV: ${(call.impliedVolatility * 100).toFixed(2)}%`
        );
      });
    }

    if (nearestExpiration.puts.length > 0) {
      lines.push('\nTop 5 Puts by Volume:');
      const topPuts = [...nearestExpiration.puts].sort((a, b) => b.volume - a.volume).slice(0, 5);
      topPuts.forEach((put) => {
        lines.push(
          `  Strike: ${put.strike.toFixed(2)} | Price: $${put.lastPrice.toFixed(2)} | Vol: ${put.volume} | OI: ${put.openInterest} | IV: ${(put.impliedVolatility * 100).toFixed(2)}%`
        );
      });
    }
  }

  lines.push('');
  return lines.join('\n');
}
