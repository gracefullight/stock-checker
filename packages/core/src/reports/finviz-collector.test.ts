import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  collectFinvizCandidates,
  defaultFinvizCollectionPlan,
  type FinvizBrowserPage,
  type FinvizCollectorDependencies,
  type FinvizCollectorOptions,
  isFinvizBrowserAvailable,
  resolveAsideExecutable,
} from '@/reports/finviz-collector';

const PLAN = defaultFinvizCollectionPlan();
const NOW = Date.parse('2026-10-05T03:30:00.000Z');
const MARKER = 'STOCK_CHECKER_FINVIZ_PAGE:';

function url(start = 1) {
  const value = new URL(PLAN.url);
  if (start !== 1) value.searchParams.set('r', String(start));
  return value.href;
}

// Minimal observed Aside DOM tree: normal Login navigation is not a login wall.
// Real v411 uses 1000 generic cells per page; tests deliberately vary page size.
function page(
  tickers: string[],
  total = tickers.length,
  start = 1,
  next?: number
): FinvizBrowserPage {
  return {
    url: url(start),
    snapshot: [
      `- title: "Stock Screener - Tickers stocksonly pb volume" [url=${url(start)}]`,
      '- link "Login" [ref=e6]',
      '- combobox "Stocks only (ex-Funds)" [ref=e48]:',
      '  - option "Stocks only (ex-Funds)" (selected) value="stocksonly"',
      `- text: "#${start} / ${total.toLocaleString('en-US')} Total"`,
      '- combobox "Page" [ref=e127]:',
      '  - option "1 / 2" (selected) value="1"',
      ...tickers.map((ticker, index) => `- generic "${ticker}" [ref=e${129 + index}]`),
      '- link "1" [ref=e1129]',
      ...(next ? ['- link "2" [ref=e1130]'] : []),
      '- link "Help" [ref=e1140]',
    ].join('\n'),
    links: [
      { name: '', href: '/' },
      { name: '1', href: url() },
      ...(next ? [{ name: '2', href: url(next) }] : []),
    ],
  };
}

function reader(pages: FinvizBrowserPage[]) {
  let index = 0;
  let clock = NOW;
  const readPage = vi.fn(async () => {
    if (!pages[index]) throw new Error('Unexpected page request');
    return structuredClone(pages[index++]);
  });
  const wait = vi.fn(async (duration: number) => {
    clock += duration;
  });
  return {
    readPage,
    wait,
    dependencies: { readPage, wait, now: () => clock } satisfies FinvizCollectorDependencies,
    advance: (duration: number) => {
      clock += duration;
    },
  };
}

afterEach(() => vi.useRealTimers());

describe('Finviz public Tickers collection', () => {
  it('preserves default SC candidate filters and explicit descending volume', () => {
    expect(PLAN.filters).toEqual(['ind_stocksonly', 'ta_sma50_pb']);
    expect(new URL(PLAN.url).searchParams.get('o')).toBe('-volume');
    expect(PLAN.filters).not.toContain('sh_avgvol_o500');
    expect(PLAN.filters).not.toContain('sh_price_o5');
    expect(PLAN.filters).not.toContain('cap_midover');
  });

  it('follows actual same-source links without assuming a fixed page size', async () => {
    const fixture = reader([page(['aapl', 'MSFT'], 3, 1, 3), page(['BRK-B'], 3, 3)]);
    const result = await collectFinvizCandidates({}, fixture.dependencies);
    expect(result).toEqual({
      status: 'available',
      tickers: ['AAPL', 'MSFT', 'BRK-B'],
      reason: null,
      provenance: {
        source: 'Finviz',
        url: PLAN.url,
        filters: PLAN.filters,
        sourceTotal: 3,
        capturedAt: '2026-10-05T03:30:00.000Z',
        completeness: 'complete',
        pages: 2,
      },
    });
    expect(fixture.readPage.mock.calls).toHaveLength(2);
    expect(fixture.wait).toHaveBeenCalledExactlyOnceWith(2000);
    expect(result.provenance).not.toHaveProperty('overallTotal');
  });

  it('reports the default first 200 as partial against the real filtered total', async () => {
    const symbols = Array.from({ length: 1000 }, (_, index) => `T${index}`);
    const fixture = reader([page(symbols, 3916, 1, 1001)]);
    const result = await collectFinvizCandidates({}, fixture.dependencies);
    expect(result.status).toBe('partial');
    expect(result.reason).toBe('candidate-limit');
    expect(result.tickers).toHaveLength(200);
    expect(result.tickers).toEqual(symbols.slice(0, 200));
    expect(result.provenance).toMatchObject({
      sourceTotal: 3916,
      completeness: 'partial',
      pages: 1,
    });
    expect(fixture.readPage).toHaveBeenCalledTimes(1);
  });

  it('can raise the candidate cap and completes only when all unique source symbols are present', async () => {
    const symbols = Array.from({ length: 201 }, (_, index) => `T${index}`);
    const fixture = reader([page(symbols)]);
    const result = await collectFinvizCandidates({ maxCandidates: 15000 }, fixture.dependencies);
    expect(result.status).toBe('available');
    expect(result.tickers).toHaveLength(201);
  });

  it('deduplicates symbols while refusing to claim that duplicate pages cover missing candidates', async () => {
    const fixture = reader([page(['AAPL', 'MSFT'], 4, 1, 3), page(['MSFT', 'BRK-B'], 4, 3)]);
    const result = await collectFinvizCandidates({}, fixture.dependencies);
    expect(result.tickers).toEqual(['AAPL', 'MSFT', 'BRK-B']);
    expect(result.status).toBe('partial');
    expect(result.reason).toBe('incomplete-collection');
    expect(result.provenance?.sourceTotal).toBe(4);
  });

  it('preserves exact optional plan filters and sort as provenance', async () => {
    const custom = new URL(PLAN.url);
    custom.searchParams.set('f', 'cap_midover,ind_stocksonly,ta_sma50_pb');
    const first = page(['AAPL']);
    first.url = custom.href;
    first.links = [{ name: '1', href: custom.href }];
    const fixture = reader([first]);
    const result = await collectFinvizCandidates(
      { plan: { url: custom.href, filters: ['cap_midover', 'ind_stocksonly', 'ta_sma50_pb'] } },
      fixture.dependencies
    );
    expect(result.provenance?.filters).toEqual(['cap_midover', 'ind_stocksonly', 'ta_sma50_pb']);
    expect(result.provenance?.url).toBe(custom.href);
  });

  it.each([
    { url: 'https://evil.invalid/screener?v=411&f=ind_stocksonly', filters: ['ind_stocksonly'] },
    {
      url: 'https://finviz.com/screener?v=411&f=ind_stocksonly&token=private',
      filters: ['ind_stocksonly'],
    },
    {
      url: 'https://finviz.com/screener?v=411&f=ind_stocksonly&f=ta_sma50_pb',
      filters: ['ind_stocksonly'],
    },
    {
      url: 'https://finviz.com/screener?v=411&f=ind_stocksonly,ind_stocksonly',
      filters: ['ind_stocksonly', 'ind_stocksonly'],
    },
    { url: PLAN.url, filters: ['ta_sma50_pb', 'ind_stocksonly'] },
    { url: PLAN.url, filters: ['ind_stocksonly', '<script>'] },
  ])('rejects unsafe or ambiguous plan metadata before browser requests: %j', async (plan) => {
    const fixture = reader([]);
    await expect(collectFinvizCandidates({ plan }, fixture.dependencies)).rejects.toThrow();
    expect(fixture.readPage).not.toHaveBeenCalled();
  });

  it.each([
    { maxCandidates: 15001 },
    { maxCandidates: 0 },
    { maxPages: 31 },
    { maxPages: 0 },
    { timeBudgetMs: 120001 },
    { timeBudgetMs: 0 },
    { minIntervalMs: -1 },
    { minIntervalMs: 30001 },
  ])(
    'rejects unsupported resource limits without I/O: %j',
    async (options: FinvizCollectorOptions) => {
      const fixture = reader([]);
      await expect(collectFinvizCandidates(options, fixture.dependencies)).rejects.toThrow(
        'Invalid Finviz collection limits'
      );
      expect(fixture.readPage).not.toHaveBeenCalled();
    }
  );

  it.each(['Just a moment', 'Verify you are human', 'Access denied', 'Security check', 'Login'])(
    'stops on %s without treating normal empty results as a wall',
    async (title) => {
      const blocked = page([]);
      blocked.snapshot = `- title: "${title}"\n- text: "#1 / 0 Total"`;
      const fixture = reader([blocked]);
      const result = await collectFinvizCandidates({}, fixture.dependencies);
      expect(result).toEqual({
        status: 'unavailable',
        tickers: [],
        provenance: null,
        reason: 'access-blocked',
      });
      expect(fixture.readPage).toHaveBeenCalledTimes(1);
    }
  );

  it('keeps previous valid candidates partial when a later page is blocked', async () => {
    const blocked = page([], 4, 3);
    blocked.snapshot = '- title: "Access denied"';
    const fixture = reader([page(['AAPL', 'MSFT'], 4, 1, 3), blocked]);
    const result = await collectFinvizCandidates({}, fixture.dependencies);
    expect(result).toMatchObject({
      status: 'partial',
      tickers: ['AAPL', 'MSFT'],
      reason: 'access-blocked',
      provenance: { sourceTotal: 4, pages: 1, completeness: 'partial' },
    });
  });

  it('reports a genuinely displayed zero separately from inaccessible or unsupported content', async () => {
    const fixture = reader([page([], 0)]);
    const result = await collectFinvizCandidates({}, fixture.dependencies);
    expect(result).toMatchObject({
      status: 'available',
      tickers: [],
      reason: null,
      provenance: { sourceTotal: 0, pages: 1, completeness: 'complete' },
    });
  });

  it.each(['AAPL/api?token=private', '<script>', 'A'.repeat(33)])(
    'refuses invalid symbol cells rather than manufacturing complete coverage: %s',
    async (ticker) => {
      const fixture = reader([page([ticker])]);
      const result = await collectFinvizCandidates({}, fixture.dependencies);
      expect(result.status).toBe('unavailable');
      expect(result.reason).toBe('unsupported-page');
      expect(JSON.stringify(result)).not.toContain('token=private');
    }
  );

  it('refuses HTML/schema drift or conflicting Total markers', async () => {
    const first = page(['AAPL']);
    first.snapshot += '\n- text: "#1 / 200 Total"';
    const fixture = reader([first]);
    expect((await collectFinvizCandidates({}, fixture.dependencies)).reason).toBe(
      'unsupported-page'
    );
  });

  it('never navigates a foreign numeric page link or a link with changed source filters', async () => {
    for (const href of [
      'https://evil.invalid/screener?v=411&f=ind_stocksonly&r=3',
      'https://finviz.com/screener?v=411&f=ind_stocksonly&o=-volume&r=3',
    ]) {
      const first = page(['AAPL', 'MSFT'], 3, 1, 3);
      first.links[2].href = href;
      const fixture = reader([first]);
      const result = await collectFinvizCandidates({}, fixture.dependencies);
      expect(result.status).toBe('unavailable');
      expect(fixture.readPage).toHaveBeenCalledTimes(1);
    }
  });

  it('stops when the page URL or filtered Total changes during collection', async () => {
    const fixture = reader([page(['AAPL', 'MSFT'], 4, 1, 3), page(['BRK-B'], 3, 3)]);
    const result = await collectFinvizCandidates({}, fixture.dependencies);
    expect(result).toMatchObject({
      status: 'partial',
      tickers: ['AAPL', 'MSFT'],
      reason: 'source-changed',
      provenance: { sourceTotal: 4, pages: 1 },
    });
  });

  it('stops instead of skipping a missing intermediate page', async () => {
    const fixture = reader([page(['AAPL', 'MSFT'], 6, 1, 5)]);
    const result = await collectFinvizCandidates({}, fixture.dependencies);
    expect(result.reason).toBe('incomplete-collection');
    expect(fixture.readPage).toHaveBeenCalledTimes(1);
  });

  it('honors the page limit without requesting or retrying another page', async () => {
    const fixture = reader([page(['AAPL', 'MSFT'], 3, 1, 3)]);
    const result = await collectFinvizCandidates({ maxPages: 1 }, fixture.dependencies);
    expect(result).toMatchObject({
      status: 'partial',
      reason: 'page-limit',
      tickers: ['AAPL', 'MSFT'],
    });
    expect(fixture.readPage).toHaveBeenCalledTimes(1);
  });

  it('does not start another request when pacing would consume the remaining deadline', async () => {
    const fixture = reader([page(['AAPL', 'MSFT'], 3, 1, 3)]);
    const result = await collectFinvizCandidates({ timeBudgetMs: 1000 }, fixture.dependencies);
    expect(result).toMatchObject({
      status: 'partial',
      reason: 'deadline',
      tickers: ['AAPL', 'MSFT'],
    });
    expect(fixture.readPage).toHaveBeenCalledTimes(1);
    expect(fixture.wait).not.toHaveBeenCalled();
  });

  it('bounds a hanging browser read and discards its late result without another request', async () => {
    vi.useFakeTimers();
    let finish!: (page: FinvizBrowserPage) => void;
    const readPage = vi.fn(
      () =>
        new Promise<FinvizBrowserPage>((resolve) => {
          finish = resolve;
        })
    );
    const pending = collectFinvizCandidates({ timeBudgetMs: 20 }, { readPage });
    await vi.advanceTimersByTimeAsync(20);
    const result = await pending;
    expect(result).toEqual({
      status: 'unavailable',
      tickers: [],
      provenance: null,
      reason: 'deadline',
    });
    finish(page(['AAPL']));
    await Promise.resolve();
    expect(readPage).toHaveBeenCalledTimes(1);
    expect(result.tickers).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sanitizes browser failures and never retries them', async () => {
    const readPage = vi
      .fn()
      .mockRejectedValue(new Error('private-account-token-raw-browser-output'));
    const result = await collectFinvizCandidates({}, { readPage });
    expect(result.reason).toBe('browser-error');
    expect(JSON.stringify(result)).not.toContain('private-account');
    expect(readPage).toHaveBeenCalledTimes(1);
  });
});

describe('Aside transport and portable readiness', () => {
  it('resolves an explicit executable by metadata only and rejects relative paths', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'finviz-cli-'));
    try {
      const executable = join(directory, 'aside');
      await writeFile(executable, '#!/bin/sh\nexit 99\n', { mode: 0o700 });
      expect(await resolveAsideExecutable(executable)).toBe(executable);
      expect(await isFinvizBrowserAvailable({ asideExecutable: executable })).toBe(true);
      expect(await resolveAsideExecutable('aside')).toBeNull();
      expect(await resolveAsideExecutable(directory)).toBeNull();
      await chmod(executable, 0o600);
      expect(await isFinvizBrowserAvailable({ asideExecutable: executable })).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('fails safely when no portable executable is found without launching a browser', async () => {
    const executeAside = vi.fn();
    const result = await collectFinvizCandidates(
      {},
      { resolveAside: async () => null, executeAside }
    );
    expect(result.reason).toBe('browser-unavailable');
    expect(executeAside).not.toHaveBeenCalled();
  });

  it('passes a literal argument to execFile and isolates and closes only its own tab', async () => {
    const fixture = page(['AAPL']);
    const owned = {
      url: () => fixture.url,
      locator: vi.fn((ref: string) => ({
        getAttribute: async () => (ref === 'e1129' ? url() : '/'),
      })),
    };
    const openTab = vi.fn(async () => owned);
    const closeTab = vi.fn(async () => undefined);
    const snapshot = vi.fn(async () => ({ tree: fixture.snapshot }));
    const executeAside = vi.fn<NonNullable<FinvizCollectorDependencies['executeAside']>>(
      async (_executable, args) => {
        const lines: string[] = [];
        const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;
        await new AsyncFunction('openTab', 'closeTab', 'snapshot', 'console', args[3])(
          openTab,
          closeTab,
          snapshot,
          { log: (line: string) => lines.push(line) }
        );
        return { stdout: `non-result CLI status\n${lines.join('\n')}\nclosed owned tab` };
      }
    );
    const result = await collectFinvizCandidates(
      {},
      { resolveAside: async () => '/portable/bin/aside', executeAside }
    );
    expect(result.status).toBe('available');
    expect(executeAside).toHaveBeenCalledWith(
      '/portable/bin/aside',
      ['repl', '--host', 'local', expect.any(String)],
      expect.objectContaining({
        timeout: expect.any(Number),
        maxBuffer: 2000000,
        killSignal: 'SIGTERM',
      })
    );
    expect(openTab).toHaveBeenCalledExactlyOnceWith(PLAN.url);
    expect(closeTab).toHaveBeenCalledExactlyOnceWith(owned);
    const code = executeAside.mock.calls[0][1][3];
    expect(code).toContain('finally');
    expect(code).not.toContain('attachBrowserTab');
    expect(code).not.toContain('getTabs');
    expect(code).not.toContain('fetch(');
  });

  it('still closes its owned tab if a snapshot fails', async () => {
    const owned = {};
    const closeTab = vi.fn(async () => undefined);
    const executeAside: NonNullable<FinvizCollectorDependencies['executeAside']> = async (
      _executable,
      args
    ) => {
      const lines: string[] = [];
      const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;
      await new AsyncFunction('openTab', 'closeTab', 'snapshot', 'console', args[3])(
        async () => owned,
        closeTab,
        async () => {
          throw new Error('private browser error');
        },
        { log: (line: string) => lines.push(line) }
      );
      return { stdout: lines.join('\n') };
    };
    const result = await collectFinvizCandidates(
      {},
      { resolveAside: async () => '/portable/bin/aside', executeAside }
    );
    expect(result.reason).toBe('browser-error');
    expect(closeTab).toHaveBeenCalledExactlyOnceWith(owned);
    expect(JSON.stringify(result)).not.toContain('private browser');
  });

  it('closes only its owned tab when a browser snapshot exceeds the deadline', async () => {
    vi.useFakeTimers();
    const owned = {};
    const closeTab = vi.fn(async () => undefined);
    const snapshot = vi.fn(() => new Promise<never>(() => undefined));
    const executeAside: NonNullable<FinvizCollectorDependencies['executeAside']> = async (
      _executable,
      args
    ) => {
      const lines: string[] = [];
      const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;
      await new AsyncFunction('openTab', 'closeTab', 'snapshot', 'console', args[3])(
        async () => owned,
        closeTab,
        snapshot,
        { log: (line: string) => lines.push(line) }
      );
      return { stdout: lines.join('\n') };
    };
    const pending = collectFinvizCandidates(
      { timeBudgetMs: 20 },
      { resolveAside: async () => '/portable/bin/aside', executeAside }
    );
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ status: 'unavailable', reason: 'deadline' });
    expect(snapshot).toHaveBeenCalledExactlyOnceWith(owned, { interactive: true });
    expect(closeTab).toHaveBeenCalledExactlyOnceWith(owned);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('closes its own late-opening tab without reading it after the deadline', async () => {
    vi.useFakeTimers();
    const owned = {};
    let opened!: (tab: object) => void;
    const opening = new Promise<object>((resolve) => {
      opened = resolve;
    });
    const closeTab = vi.fn(async () => undefined);
    const snapshot = vi.fn();
    const executeAside: NonNullable<FinvizCollectorDependencies['executeAside']> = async (
      _executable,
      args
    ) => {
      const lines: string[] = [];
      const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;
      await new AsyncFunction('openTab', 'closeTab', 'snapshot', 'console', args[3])(
        () => opening,
        closeTab,
        snapshot,
        { log: (line: string) => lines.push(line) }
      );
      return { stdout: lines.join('\n') };
    };
    const pending = collectFinvizCandidates(
      { timeBudgetMs: 20 },
      { resolveAside: async () => '/portable/bin/aside', executeAside }
    );
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ status: 'unavailable', reason: 'deadline' });
    expect(closeTab).not.toHaveBeenCalled();
    opened(owned);
    await vi.advanceTimersByTimeAsync(0);
    expect(closeTab).toHaveBeenCalledExactlyOnceWith(owned);
    expect(snapshot).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['', `${MARKER}{}\n${MARKER}{}`, `${MARKER}{invalid-json`])(
    'rejects missing, ambiguous or malformed protocol results',
    async (stdout) => {
      const result = await collectFinvizCandidates(
        {},
        { resolveAside: async () => '/portable/bin/aside', executeAside: async () => ({ stdout }) }
      );
      expect(result.status).toBe('unavailable');
      expect(result.provenance).toBeNull();
    }
  );
});
