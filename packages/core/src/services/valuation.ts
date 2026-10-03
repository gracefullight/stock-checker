import yahooFinance from '@/services/yahoo-finance';
import { getYahooIndustry } from '@/services/yahoo-industry';

export interface CompanyValuation {
  trailingPE: number | null;
  forwardPE: number | null;
  psr: number | null;
  currency: string | null;
  sector: string | null;
  industry: string | null;
  industryKey: string | null;
  priceAsOf: string | null;
  sourceUrl: string;
  peReason: string | null;
  psrReason: string | null;
}

export interface ValuationPeer {
  ticker: string;
  trailingPE: number | null;
  psr: number | null;
  industry: string;
  currency: string | null;
}

export interface IndustryValuationComparison {
  status: 'available' | 'partial' | 'unavailable';
  medianPE: number | null;
  medianPSR: number | null;
  peSamples: number;
  psrSamples: number;
  peers: ValuationPeer[];
  method: string;
  sourceUrl: string | null;
  universe: string;
  coverage: {
    candidateCount: number;
    requestedCount: number;
    matchingIndustryCount: number;
    failedRequests: number;
    excludedIndustryCount: number;
    excludedNonEquityCount: number;
    providerCompanyCount: number | null;
    peerLimit: number;
    minimumSamples: number;
  };
  reason: string | null;
}

export interface ValuationReport {
  ticker: string;
  retrievedAt: string;
  company: CompanyValuation;
  industryComparison: IndustryValuationComparison;
  relative: {
    pePremiumPct: number | null;
    psrPremiumPct: number | null;
  };
  warnings: string[];
}

interface ParsedSummary {
  company: CompanyValuation;
  quoteType: string | null;
}

const NETWORK_TIMEOUT_MS = 8_000;
const PEER_LIMIT = 12;
const PEER_CONCURRENCY = 3;
const MINIMUM_SAMPLES = 3;
const CACHE_TTL_MS = 15 * 60 * 1_000;
const CACHE_LIMIT = 128;
const IN_FLIGHT_LIMIT = 32;
const cache = new Map<string, { expiresAt: number; report: ValuationReport }>();
const inFlight = new Map<string, Promise<ValuationReport>>();
const summaryWaiters: Array<() => void> = [];
let activeSummaryRequests = 0;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function numeric(value: unknown): number | null {
  const raw = record(value)?.raw ?? value;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

function positive(value: unknown): number | null {
  const number = numeric(value);
  return number !== null && number > 0 ? number : null;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\p{Cc}/gu, ' ').trim();
  return normalized.length > 0 ? normalized.slice(0, 200) : null;
}

function validSymbol(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const symbol = value.trim().toUpperCase();
  return symbol.length >= 1 &&
    symbol.length <= 32 &&
    /^\^?[A-Z0-9]+(?:[.-][A-Z0-9]+)*(?:=[A-Z0-9]+)?$/.test(symbol)
    ? symbol
    : null;
}

function industryKey(value: unknown): string | null {
  return typeof value === 'string' &&
    value.length <= 128 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
    ? value
    : null;
}

function quoteTimestamp(value: unknown): string | null {
  const raw = record(value)?.raw ?? value;
  const timestamp =
    raw instanceof Date
      ? raw.getTime()
      : typeof raw === 'number' && Number.isFinite(raw)
        ? raw * 1_000
        : Number.NaN;
  return Number.isFinite(timestamp) && timestamp > 0 && timestamp <= Date.now()
    ? new Date(timestamp).toISOString()
    : null;
}

function parseSummary(ticker: string, summary: unknown): ParsedSummary {
  const root = record(summary);
  const detail = record(root?.summaryDetail);
  const profile = record(root?.summaryProfile);
  const price = record(root?.price);
  const statistics = record(root?.defaultKeyStatistics);
  const eps = numeric(statistics?.trailingEps) ?? numeric(detail?.epsTrailingTwelveMonths);
  const rawPE = numeric(detail?.trailingPE);
  const trailingPE = eps !== null && eps <= 0 ? null : positive(rawPE);
  const psr = positive(detail?.priceToSalesTrailing12Months);
  return {
    quoteType: text(price?.quoteType),
    company: {
      trailingPE,
      forwardPE: positive(detail?.forwardPE),
      psr,
      currency: text(price?.currency) ?? text(detail?.currency),
      sector: text(profile?.sector),
      industry: text(profile?.industry),
      industryKey: industryKey(profile?.industryKey),
      priceAsOf: quoteTimestamp(price?.regularMarketTime),
      sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}/key-statistics/`,
      peReason:
        trailingPE !== null
          ? null
          : (eps !== null && eps <= 0) || (rawPE !== null && rawPE <= 0)
            ? 'Trailing PER is not meaningful for nonpositive trailing earnings.'
            : 'Yahoo Finance did not supply a positive finite trailing PER.',
      psrReason:
        psr !== null ? null : 'Yahoo Finance did not supply a positive finite trailing PSR.',
    },
  };
}

async function fetchSummary(ticker: string): Promise<ParsedSummary> {
  // Share the limit across concurrent reports, not just each report's peers.
  if (activeSummaryRequests >= PEER_CONCURRENCY) {
    await new Promise<void>((resolve) => summaryWaiters.push(resolve));
  } else {
    activeSummaryRequests++;
  }
  try {
    const result = await yahooFinance.quoteSummary(
      ticker,
      { modules: ['summaryDetail', 'summaryProfile', 'price', 'defaultKeyStatistics'] },
      {
        validateResult: false,
        fetchOptions: { signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS) },
      }
    );
    return parseSummary(ticker, result);
  } finally {
    const next = summaryWaiters.shift();
    if (next) next();
    else activeSummaryRequests--;
  }
}

function emptyComparison(key: string | null): IndustryValuationComparison {
  return {
    status: 'unavailable',
    medianPE: null,
    medianPSR: null,
    peSamples: 0,
    psrSamples: 0,
    peers: [],
    method:
      'Unweighted median of positive finite TTM ratios for verified same-industry equities, excluding the subject; each metric requires at least 3 peers.',
    sourceUrl: key
      ? `https://query1.finance.yahoo.com/v1/finance/industries/${encodeURIComponent(key)}`
      : null,
    universe: 'Yahoo Finance US industry topCompanies; selected companies, not the whole industry.',
    coverage: {
      candidateCount: 0,
      requestedCount: 0,
      matchingIndustryCount: 0,
      failedRequests: 0,
      excludedIndustryCount: 0,
      excludedNonEquityCount: 0,
      providerCompanyCount: null,
      peerLimit: PEER_LIMIT,
      minimumSamples: MINIMUM_SAMPLES,
    },
    reason: null,
  };
}

function median(values: number[]): number | null {
  if (values.length < MINIMUM_SAMPLES) return null;
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 1 ? values[middle] : values[middle - 1] / 2 + values[middle] / 2;
}

function premium(value: number | null, comparison: number | null): number | null {
  if (value === null || comparison === null) return null;
  const percent = (value / comparison - 1) * 100;
  return Number.isFinite(percent) ? percent : null;
}

async function compareIndustry(
  ticker: string,
  company: CompanyValuation,
  warnings: string[]
): Promise<IndustryValuationComparison> {
  const comparison = emptyComparison(company.industryKey);
  if (!company.industry || !company.industryKey) {
    comparison.reason = 'Yahoo Finance did not supply a valid company industry and industry key.';
    return comparison;
  }
  let payload: unknown;
  try {
    payload = await getYahooIndustry(company.industryKey);
  } catch {
    comparison.reason = 'Yahoo Finance industry-company request failed.';
    warnings.push(comparison.reason);
    return comparison;
  }
  const data = record(record(payload)?.data);
  const topCompanies = data?.topCompanies;
  if (!Array.isArray(topCompanies)) {
    comparison.reason = 'Yahoo Finance did not supply an industry-company list.';
    return comparison;
  }
  const count = positive(record(data?.overview)?.companiesCount);
  comparison.coverage.providerCompanyCount =
    count !== null && Number.isSafeInteger(count) ? count : null;
  const candidates = [
    ...new Set(
      topCompanies
        .slice(0, 500)
        .map((row) => validSymbol(record(row)?.symbol))
        .filter((symbol): symbol is string => symbol !== null && symbol !== ticker)
    ),
  ];
  comparison.coverage.candidateCount = candidates.length;
  const requested = candidates.slice(0, PEER_LIMIT);
  comparison.coverage.requestedCount = requested.length;
  const results: Array<ParsedSummary | null> = Array(requested.length).fill(null);
  let nextIndex = 0;
  // Bound both the number of requests and simultaneous provider connections.
  await Promise.all(
    Array.from({ length: Math.min(PEER_CONCURRENCY, requested.length) }, async () => {
      while (nextIndex < requested.length) {
        const index = nextIndex++;
        try {
          results[index] = await fetchSummary(requested[index]);
        } catch {
          comparison.coverage.failedRequests++;
        }
      }
    })
  );
  for (let index = 0; index < requested.length; index++) {
    const result = results[index];
    if (!result) continue;
    if (result.quoteType !== 'EQUITY') {
      comparison.coverage.excludedNonEquityCount++;
      continue;
    }
    if (result.company.industryKey !== company.industryKey || !result.company.industry) {
      comparison.coverage.excludedIndustryCount++;
      continue;
    }
    comparison.peers.push({
      ticker: requested[index],
      trailingPE: result.company.trailingPE,
      psr: result.company.psr,
      industry: result.company.industry,
      currency: result.company.currency,
    });
  }
  comparison.coverage.matchingIndustryCount = comparison.peers.length;
  const peValues = comparison.peers
    .map((peer) => peer.trailingPE)
    .filter((value): value is number => value !== null);
  const psrValues = comparison.peers
    .map((peer) => peer.psr)
    .filter((value): value is number => value !== null);
  comparison.peSamples = peValues.length;
  comparison.psrSamples = psrValues.length;
  comparison.medianPE = median(peValues);
  comparison.medianPSR = median(psrValues);
  comparison.status =
    comparison.medianPE !== null && comparison.medianPSR !== null
      ? 'available'
      : comparison.medianPE !== null || comparison.medianPSR !== null
        ? 'partial'
        : 'unavailable';
  comparison.reason =
    comparison.status === 'available'
      ? null
      : `At least ${MINIMUM_SAMPLES} valid peers per metric are required; trailing PER has ${comparison.peSamples}, PSR has ${comparison.psrSamples}.`;
  if (comparison.coverage.failedRequests > 0) {
    warnings.push(`${comparison.coverage.failedRequests} peer valuation requests failed.`);
  }
  return comparison;
}

async function loadValuation(ticker: string): Promise<ValuationReport> {
  const warnings = [
    'Peer medians describe a limited provider-selected sample, not an industry-wide aggregate.',
    'PER and PSR use provider trailing-12-month ratios; financial period-end and publication timestamps are not supplied. Forward PER is separate.',
    'retrievedAt is the retrieval time; priceAsOf is the quote time, not a financial publication time.',
    'Relative valuation does not establish a buy signal or a probability of profit.',
  ];
  let parsed: ParsedSummary;
  try {
    parsed = await fetchSummary(ticker);
  } catch {
    parsed = parseSummary(ticker, null);
    parsed.company.peReason = 'Yahoo Finance company-valuation request failed.';
    parsed.company.psrReason = parsed.company.peReason;
    warnings.push(parsed.company.peReason);
  }
  let comparison: IndustryValuationComparison;
  if (parsed.quoteType !== null && parsed.quoteType !== 'EQUITY') {
    parsed.company.trailingPE = null;
    parsed.company.forwardPE = null;
    parsed.company.psr = null;
    parsed.company.peReason = 'The company valuation comparison requires an equity instrument.';
    parsed.company.psrReason = parsed.company.peReason;
    comparison = emptyComparison(parsed.company.industryKey);
    comparison.reason = parsed.company.peReason;
  } else {
    comparison = await compareIndustry(ticker, parsed.company, warnings);
  }
  return {
    ticker,
    retrievedAt: new Date().toISOString(),
    company: parsed.company,
    industryComparison: comparison,
    relative: {
      pePremiumPct: premium(parsed.company.trailingPE, comparison.medianPE),
      psrPremiumPct: premium(parsed.company.psr, comparison.medianPSR),
    },
    warnings,
  };
}

/** Yahoo valuation evidence, with nullable independently qualified peer medians. */
export async function getValuation(ticker: string): Promise<ValuationReport> {
  const symbol = validSymbol(ticker);
  if (!symbol) throw new Error('Invalid ticker');
  const cached = cache.get(symbol);
  if (cached && cached.expiresAt > Date.now()) return structuredClone(cached.report);
  if (cached) cache.delete(symbol);
  const pending = inFlight.get(symbol);
  if (pending) return structuredClone(await pending);
  if (inFlight.size >= IN_FLIGHT_LIMIT) throw new Error('Valuation request capacity exceeded');
  const request = loadValuation(symbol);
  inFlight.set(symbol, request);
  try {
    const report = await request;
    if (cache.size >= CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(symbol, { expiresAt: Date.now() + CACHE_TTL_MS, report });
    return structuredClone(report);
  } finally {
    inFlight.delete(symbol);
  }
}
