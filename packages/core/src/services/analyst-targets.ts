import { DateTime } from 'luxon';
import yahooFinance from '@/services/yahoo-finance';

type AnalystTargetSource = 'Yahoo Finance' | 'Financial Modeling Prep';

export interface AnalystConsensus {
  source: 'Yahoo Finance';
  sourceUrl: string;
  retrievedAt: string;
  /** Yahoo does not supply a publication timestamp or forecast horizon. */
  publishedAt: null;
  horizon: null;
  currency: string | null;
  currentPrice: number | null;
  mean: number | null;
  median: number | null;
  low: number | null;
  high: number | null;
  analystCount: number | null;
  meanUpsidePercent: number | null;
}

export interface AnalystTargetUpdate {
  source: AnalystTargetSource;
  sourceUrl: string | null;
  publishedAt: string;
  firm: string;
  analystName: string | null;
  targetPrice: number;
  /** Individual target records do not declare a verified quote currency. */
  currency: null;
  priorTargetPrice: number | null;
  priceWhenPosted: number | null;
  rating: string | null;
  action: string | null;
  horizon: null;
}

export interface RecentAnalystTargets {
  status: 'available' | 'unavailable';
  source: AnalystTargetSource | null;
  retrievedAt: string;
  windowDays: 90;
  /** Counts cover returned records, not necessarily every update in the window. */
  count30Days: number;
  updates: AnalystTargetUpdate[];
  limit: number | null;
  reason: string | null;
}

export interface AnalystTargetsReport {
  ticker: string;
  retrievedAt: string;
  consensus: AnalystConsensus | null;
  recent: RecentAnalystTargets;
  warnings: string[];
}

const NETWORK_TIMEOUT_MS = 8_000;
const DAY_MS = 86_400_000;
const FMP_RECORD_LIMIT = 20;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function positivePrice(value: unknown): number | null {
  const number = record(value)?.raw ?? value;
  return typeof number === 'number' && Number.isFinite(number) && number > 0 ? number : null;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\p{Cc}/gu, ' ').trim();
  return normalized.length > 0 ? normalized.slice(0, 200) : null;
}

function publicationDate(value: unknown, now: number): string | null {
  const raw = record(value)?.raw ?? value;
  let timestamp: number;
  if (raw instanceof Date) {
    timestamp = raw.getTime();
  } else if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    // Yahoo epochGradeDate is seconds before the client coerces it to Date.
    timestamp = raw * 1_000;
  } else if (
    typeof raw === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(raw)
  ) {
    const parsed = DateTime.fromISO(raw, { setZone: true });
    timestamp = parsed.isValid ? parsed.toMillis() : Number.NaN;
  } else {
    return null;
  }
  return Number.isFinite(timestamp) && timestamp > 0 && timestamp <= now
    ? new Date(timestamp).toISOString()
    : null;
}

function safeSourceUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function parseConsensus(
  summary: unknown,
  sourceUrl: string,
  retrievedAt: string
): AnalystConsensus | null {
  const root = record(summary);
  const data = record(root?.financialData);
  const price = record(root?.price);
  if (!data) return null;
  const mean = positivePrice(data.targetMeanPrice);
  const median = positivePrice(data.targetMedianPrice);
  let low = positivePrice(data.targetLowPrice);
  let high = positivePrice(data.targetHighPrice);
  if (low !== null && high !== null && low > high) {
    low = null;
    high = null;
  }
  if ([mean, median, low, high].every((value) => value === null)) return null;
  const currentPrice = positivePrice(data.currentPrice) ?? positivePrice(price?.regularMarketPrice);
  const count = positivePrice(data.numberOfAnalystOpinions);
  const upside = mean !== null && currentPrice !== null ? (mean / currentPrice - 1) * 100 : null;
  return {
    source: 'Yahoo Finance',
    sourceUrl,
    retrievedAt,
    publishedAt: null,
    horizon: null,
    currency: text(price?.currency),
    currentPrice,
    mean,
    median,
    low,
    high,
    analystCount: count !== null && Number.isSafeInteger(count) ? count : null,
    meanUpsidePercent: upside !== null && Number.isFinite(upside) ? upside : null,
  };
}

function parseYahooUpdates(
  summary: unknown,
  sourceUrl: string,
  now: number
): AnalystTargetUpdate[] {
  const history = record(record(summary)?.upgradeDowngradeHistory)?.history;
  if (!Array.isArray(history)) return [];
  const updates: AnalystTargetUpdate[] = [];
  for (const value of history) {
    const row = record(value);
    if (!row) continue;
    const targetPrice = positivePrice(row.currentPriceTarget);
    const publishedAt = publicationDate(row.epochGradeDate, now);
    const firm = text(row.firm);
    // Rating changes without an actual numeric price target are not target updates.
    if (targetPrice === null || publishedAt === null || firm === null) continue;
    updates.push({
      source: 'Yahoo Finance',
      sourceUrl,
      publishedAt,
      firm,
      analystName: null,
      targetPrice,
      currency: null,
      priorTargetPrice: positivePrice(row.priorPriceTarget),
      priceWhenPosted: null,
      rating: text(row.toGrade),
      action: text(row.priceTargetAction) ?? text(row.action),
      horizon: null,
    });
  }
  return updates;
}

function parseFmpUpdates(values: unknown[], ticker: string, now: number): AnalystTargetUpdate[] {
  const updates: AnalystTargetUpdate[] = [];
  for (const value of values.slice(0, FMP_RECORD_LIMIT)) {
    const row = record(value);
    if (!row || text(row.symbol)?.toUpperCase() !== ticker) continue;
    const targetPrice = positivePrice(row.priceTarget);
    const publishedAt = publicationDate(row.publishedDate, now);
    const firm = text(row.analystCompany);
    if (targetPrice === null || publishedAt === null || firm === null) continue;
    updates.push({
      source: 'Financial Modeling Prep',
      sourceUrl: safeSourceUrl(row.newsURL),
      publishedAt,
      firm,
      analystName: text(row.analystName),
      targetPrice,
      currency: null,
      priorTargetPrice: positivePrice(row.priorPriceTarget),
      priceWhenPosted: positivePrice(row.priceWhenPosted),
      rating: null,
      action: null,
      horizon: null,
    });
  }
  return updates;
}

function recentTargets(
  updates: AnalystTargetUpdate[],
  source: AnalystTargetSource,
  retrievedAt: string,
  now: number,
  limit: number | null
): RecentAnalystTargets {
  const seen = new Set<string>();
  const recent = updates
    .filter((update) => Date.parse(update.publishedAt) >= now - 90 * DAY_MS)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .filter((update) => {
      const key = `${update.publishedAt}|${update.firm}|${update.targetPrice}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return {
    status: 'available',
    source,
    retrievedAt,
    windowDays: 90,
    count30Days: recent.filter((update) => Date.parse(update.publishedAt) >= now - 30 * DAY_MS)
      .length,
    updates: recent,
    limit,
    reason: null,
  };
}

/** Consensus and dated target updates are evidence, not probabilities of hitting a trading target. */
export async function getAnalystTargets(ticker: string): Promise<AnalystTargetsReport> {
  const symbol = ticker.trim().toUpperCase();
  if (
    symbol.length < 1 ||
    symbol.length > 32 ||
    !/^\^?[A-Z0-9]+(?:[.-][A-Z0-9]+)*(?:=[A-Z0-9]+)?$/.test(symbol)
  ) {
    throw new Error('Invalid ticker');
  }
  const sourceUrl = `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/analysis/`;
  const warnings = [
    'Analyst forecast horizons and consensus publication time are not supplied by these providers.',
    'Recent counts describe returned provider records and may omit other analyst updates.',
  ];
  // Keep independent requests: a bad history module must not discard a valid consensus.
  const [summary, history] = await Promise.allSettled([
    yahooFinance.quoteSummary(
      symbol,
      { modules: ['financialData', 'price'] },
      { validateResult: false, fetchOptions: { signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS) } }
    ),
    yahooFinance.quoteSummary(
      symbol,
      { modules: ['upgradeDowngradeHistory'] },
      { validateResult: false, fetchOptions: { signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS) } }
    ),
  ]);
  const now = Date.now();
  const retrievedAt = new Date(now).toISOString();
  const consensus =
    summary.status === 'fulfilled' ? parseConsensus(summary.value, sourceUrl, retrievedAt) : null;
  if (summary.status === 'rejected') warnings.push('Yahoo Finance consensus request failed.');
  else if (consensus === null)
    warnings.push('Yahoo Finance did not supply valid consensus targets.');
  if (history.status === 'rejected') warnings.push('Yahoo Finance analyst-history request failed.');
  const yahooUpdates =
    history.status === 'fulfilled' ? parseYahooUpdates(history.value, sourceUrl, now) : [];
  if (yahooUpdates.length > 0) {
    return {
      ticker: symbol,
      retrievedAt,
      consensus,
      recent: recentTargets(yahooUpdates, 'Yahoo Finance', retrievedAt, now, null),
      warnings,
    };
  }

  const apiKey = process.env.FMP_API_KEY?.trim();
  let reason = 'Yahoo Finance has no valid dated targets; optional FMP_API_KEY is not configured.';
  if (apiKey) {
    try {
      const url = new URL('https://financialmodelingprep.com/stable/price-target-news');
      url.search = new URLSearchParams({
        symbol,
        page: '0',
        limit: String(FMP_RECORD_LIMIT),
        apikey: apiKey,
      }).toString();
      const response = await fetch(url, {
        signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
        redirect: 'error',
      });
      if (!response.ok) throw new Error('Target provider unavailable');
      const payload: unknown = await response.json();
      if (!Array.isArray(payload)) throw new Error('Target provider returned invalid data');
      const fmpNow = Date.now();
      const fmpRetrievedAt = new Date(fmpNow).toISOString();
      const updates = parseFmpUpdates(payload, symbol, fmpNow);
      if (payload.length > 0 && updates.length === 0) {
        reason = 'Financial Modeling Prep did not supply valid dated targets.';
      } else {
        return {
          ticker: symbol,
          retrievedAt: fmpRetrievedAt,
          consensus,
          recent: recentTargets(
            updates,
            'Financial Modeling Prep',
            fmpRetrievedAt,
            fmpNow,
            FMP_RECORD_LIMIT
          ),
          warnings,
        };
      }
    } catch {
      // Never include an exception or request URL: either can contain the API key.
      reason = 'Financial Modeling Prep target request failed.';
      warnings.push(reason);
    }
  }
  const finishedAt = new Date().toISOString();
  return {
    ticker: symbol,
    retrievedAt: finishedAt,
    consensus,
    recent: {
      status: 'unavailable',
      source: null,
      retrievedAt: finishedAt,
      windowDays: 90,
      count30Days: 0,
      updates: [],
      limit: null,
      reason,
    },
    warnings,
  };
}
