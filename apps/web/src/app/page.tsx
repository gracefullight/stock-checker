import { ScreenerTable } from '@/components/screener-table';
import { getScreener } from '@/lib/api';

const TICKERS = [
  'TSLA',
  'PLTR',
  'GOOGL',
  'NVDA',
  'AAPL',
  'META',
  'AMD',
  'MSFT',
  'AMZN',
  'NFLX',
  'CRWD',
  'NET',
  'DDOG',
  'COIN',
  'SOFI',
  'SQ',
  'SHOP',
  'UBER',
  'SNAP',
  'PINS',
];

export default async function ScreenerPage() {
  let results;
  let error: string | null = null;

  try {
    results = await getScreener(TICKERS);
  } catch (err) {
    error = err instanceof Error ? err.message : 'Failed to fetch screener data';
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-sm font-bold font-mono tracking-widest text-[var(--cyan)]">
          EQUITY SCREENER — {TICKERS.length} SYMBOLS
        </h1>
        <span className="text-xs font-mono text-[var(--text-secondary)]">
          {new Date().toISOString().split('T')[0]}
        </span>
      </div>

      {error ? (
        <div
          className="p-4 border border-[var(--red)] bg-[var(--surface)] font-mono text-xs text-[var(--red)]"
          role="alert"
        >
          ERROR: {error}
        </div>
      ) : !results ? (
        <div className="p-4 font-mono text-xs text-[var(--text-secondary)]" aria-live="polite">
          LOADING...
        </div>
      ) : results.length === 0 ? (
        <div className="p-4 font-mono text-xs text-[var(--text-secondary)]">NO DATA AVAILABLE</div>
      ) : (
        <div className="border border-[var(--border)] bg-[var(--surface)]">
          <div className="px-3 py-1.5 border-b border-[var(--border)] flex items-center gap-2">
            <span className="text-[10px] font-mono text-[var(--text-secondary)]">
              {results.length} RESULTS — SORTED BY SCORE DESC BY DEFAULT
            </span>
          </div>
          <ScreenerTable results={results} />
        </div>
      )}
    </div>
  );
}
