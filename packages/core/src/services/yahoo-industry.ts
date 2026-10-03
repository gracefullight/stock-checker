import { _getCrumb, getCrumbClear } from 'yahoo-finance2/lib/getCrumb';
import { yahooCookieJar } from '@/services/yahoo-finance';

// Use the SDK's exported cookie/crumb helpers, without accessing private client fields.
// Authentication diagnostics can contain cookies or crumbs; never emit them.
const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  dir: () => {},
};
let authentication: Promise<string | null> | null = null;

export async function getYahooIndustry(industryKey: string): Promise<unknown> {
  if (industryKey.length > 128 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(industryKey)) {
    throw new TypeError('Invalid Yahoo Finance industry key');
  }
  const signal = AbortSignal.timeout(8_000);
  if (!authentication) {
    authentication = _getCrumb(yahooCookieJar, fetch, { signal }, silentLogger).finally(() => {
      authentication = null;
    });
  }
  const crumb = await authentication;
  if (!crumb) throw new Error('Yahoo Finance industry authentication is unavailable');
  const url = new URL(`https://query1.finance.yahoo.com/v1/finance/industries/${industryKey}`);
  url.searchParams.set('crumb', crumb);
  url.searchParams.set('formatted', 'false');
  url.searchParams.set('lang', 'en-US');
  url.searchParams.set('region', 'US');
  const response = await fetch(url, {
    signal,
    headers: { cookie: await yahooCookieJar.getCookieString(url.href) },
  });
  if (!response.ok) {
    if (response.status === 401) await getCrumbClear(yahooCookieJar);
    throw new Error(`Yahoo Finance industry request failed (${response.status})`);
  }
  return response.json();
}
