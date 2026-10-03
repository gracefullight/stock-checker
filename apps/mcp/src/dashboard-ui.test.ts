import { describe, expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import {
  DASHBOARD_MIME_TYPE,
  DASHBOARD_RESOURCE_META,
  DASHBOARD_RESOURCE_URI,
  dashboardHtml,
  dashboardUiScript,
} from '@mcp/dashboard-ui';
import { fixtureReport, fixtureValuation } from '@mcp/test-fixtures/report';

type DomEvent = { key?: string; clientX?: number; preventDefault: () => void };

class TestElement {
  textContent = '';
  className = '';
  hidden = false;
  href = '';
  target = '';
  rel = '';
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  children: TestElement[] = [];
  listeners = new Map<string, (event: DomEvent) => void>();

  constructor(public tag: string) {}

  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }

  append(...children: TestElement[]) {
    this.children.push(...children);
  }

  replaceChildren(...children: TestElement[]) {
    this.children = children;
  }

  addEventListener(name: string, listener: (event: DomEvent) => void) {
    this.listeners.set(name, listener);
  }

  getBoundingClientRect() {
    return { width: 900, height: 650, left: 0 };
  }
}

function testView(referrer = 'https://host.example/chat') {
  const nodes = new Map<string, TestElement>();
  for (const match of dashboardHtml.matchAll(/id="([^"]+)"/g)) {
    nodes.set(match[1]!, new TestElement('div'));
  }
  const periods = [1, 3, 6, 12].map((months) => {
    const node = new TestElement('button');
    node.dataset.months = String(months);
    return node;
  });
  const modes = ['candles', 'line'].map((chartType) => {
    const node = new TestElement('button');
    node.dataset.chartType = chartType;
    return node;
  });
  const root = new TestElement('html');
  const messages: { message: Record<string, unknown>; origin: string }[] = [];
  const parent = {
    postMessage(message: Record<string, unknown>, origin: string) {
      messages.push({ message, origin });
    },
  };
  type Incoming = { source: unknown; origin: string; data: Record<string, unknown> };
  let receive: ((event: Incoming) => void) | undefined;
  const window = {
    parent,
    addEventListener(_name: string, listener: (event: Incoming) => void) {
      receive = listener;
    },
    removeEventListener() {
      receive = undefined;
    },
  };
  const document = {
    referrer,
    body: new TestElement('body'),
    documentElement: Object.assign(root, { clientWidth: 900 }),
    getElementById(id: string) {
      const node = nodes.get(id);
      if (!node) throw new Error(`Unexpected node ${id}`);
      return node;
    },
    createElement(tag: string) {
      return new TestElement(tag);
    },
    createElementNS(_namespace: string, tag: string) {
      return new TestElement(tag);
    },
    querySelectorAll(selector: string) {
      return selector === '[data-months]' ? periods : modes;
    },
  };
  runInNewContext(dashboardUiScript, { document, window, URL }, { timeout: 1000 });
  const dispatch = (
    data: Record<string, unknown>,
    options: { source?: unknown; origin?: string } = {}
  ) => {
    receive?.({
      source: options.source ?? parent,
      origin: options.origin ?? 'https://host.example',
      data,
    });
  };
  const initialize = (origin = 'https://host.example') =>
    dispatch(
      {
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: '2026-01-26',
          hostInfo: { name: 'test-host', version: '1' },
          hostCapabilities: { openLinks: {} },
          hostContext: { theme: 'dark' },
        },
      },
      { origin }
    );
  const deliver = (payload: unknown, options: { source?: unknown; origin?: string } = {}) =>
    dispatch(
      {
        jsonrpc: '2.0',
        method: 'ui/notifications/tool-result',
        params: { structuredContent: payload },
      },
      options
    );
  return { nodes, root, periods, modes, messages, parent, dispatch, initialize, deliver };
}

const candle = (date: string, close = 102) => ({
  date,
  open: 100,
  high: Math.max(104, close),
  low: 98,
  close,
  volume: 150_000,
});

describe('MCP Apps dashboard resource', () => {
  test('declares a self-contained UI resource without external fetches or assets', () => {
    expect(DASHBOARD_RESOURCE_URI).toBe('ui://stock-checker/dashboard');
    expect(DASHBOARD_MIME_TYPE).toBe('text/html;profile=mcp-app');
    expect(DASHBOARD_RESOURCE_META.ui.csp.connectDomains).toEqual([]);
    expect(DASHBOARD_RESOURCE_META.ui.csp.resourceDomains).toEqual([]);
    expect(dashboardHtml).toContain('lang="ko"');
    expect(dashboardHtml).toContain('role="img" tabindex="0"');
    expect(dashboardHtml).toContain('aria-describedby="chart-summary chart-help chart-readout"');
    expect(dashboardUiScript).not.toMatch(/innerHTML|insertAdjacentHTML|\bfetch\(|\beval\(/);
    expect(dashboardHtml).not.toMatch(/<script[^>]+src=|<link[^>]+href=|<iframe/);
  });

  test('completes the stable initialization handshake before accepting results', () => {
    const view = testView();
    expect(view.messages[0]?.message).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      method: 'ui/initialize',
      params: {
        protocolVersion: '2026-01-26',
        appCapabilities: { availableDisplayModes: ['inline'] },
      },
    });
    expect(view.messages[0]?.origin).toBe('https://host.example');
    view.deliver({ report: fixtureReport('EARLY') });
    expect(view.nodes.get('ticker')?.textContent).toBe('');
    view.initialize();
    expect(view.root.dataset.theme).toBe('dark');
    expect(view.messages[1]?.message.method).toBe('ui/notifications/initialized');
    expect(view.messages[2]?.message).toMatchObject({
      method: 'ui/notifications/size-changed',
      params: { width: 900, height: 650 },
    });
    view.deliver({ report: fixtureReport('OII') });
    expect(view.nodes.get('ticker')?.textContent).toBe('OII');
  });

  test('rejects messages from other frames and changed parent origins', () => {
    const view = testView('');
    view.initialize();
    view.deliver({ report: fixtureReport('OII') });
    view.deliver(
      { report: fixtureReport('WRONG') },
      { source: {}, origin: 'https://host.example' }
    );
    view.deliver({ report: fixtureReport('WRONG') }, { origin: 'https://attacker.example' });
    expect(view.nodes.get('ticker')?.textContent).toBe('OII');
  });

  test('rejects an unsupported protocol response', () => {
    const view = testView();
    view.dispatch({ jsonrpc: '2.0', id: 1, result: { protocolVersion: 'unsupported' } });
    view.deliver({ report: fixtureReport('OII') });
    expect(view.nodes.get('ticker')?.textContent).toBe('');
    expect(view.nodes.get('status')?.textContent).toContain('초기화하지 못했습니다');
  });

  test('hides a previous report while a different ticker is loading or a result fails', () => {
    const view = testView();
    view.initialize();
    view.deliver({ report: fixtureReport('OII') });
    expect(view.nodes.get('dashboard')?.hidden).toBe(false);
    view.dispatch({
      jsonrpc: '2.0',
      method: 'ui/notifications/tool-input',
      params: { arguments: { ticker: 'SPCX' } },
    });
    expect(view.nodes.get('dashboard')?.hidden).toBe(true);
    expect(view.nodes.get('ticker')?.textContent).toBe('SPCX');
    expect(view.nodes.get('latest-price')?.textContent).toBe('—');
    view.dispatch({
      jsonrpc: '2.0',
      method: 'ui/notifications/tool-result',
      params: { isError: true, content: [] },
    });
    expect(view.nodes.get('dashboard')?.hidden).toBe(true);
    expect(view.nodes.get('status')?.textContent).toContain('완료하지 못했습니다');
    view.deliver({ report: fixtureReport('SPCX') });
    view.dispatch({
      jsonrpc: '2.0',
      method: 'ui/notifications/tool-cancelled',
      params: { reason: 'done' },
    });
    expect(view.nodes.get('dashboard')?.hidden).toBe(true);
    expect(view.nodes.get('latest-price')?.textContent).toBe('—');
  });

  test('preserves unknown entry and empty historical rates, while showing bounded valuation', () => {
    const view = testView();
    view.initialize();
    const report = fixtureReport('OII');
    report.valuation = fixtureValuation('OII');
    view.deliver({ report, chart: { ticker: 'OII', status: 'unavailable', reason: 'No candles' } });
    expect(view.nodes.get('win-rate')?.textContent).toBe('자료 없음');
    expect(view.nodes.get('stop-rate')?.textContent).toBe('자료 없음');
    expect(view.nodes.get('target-rate')?.textContent).toBe('자료 없음');
    expect(view.nodes.get('entry-price')?.textContent).toContain('아직 알 수 없음');
    expect(view.nodes.get('stock-pe')?.textContent).toBe('24.00배');
    expect(view.nodes.get('peer-pe')?.textContent).toBe('20.00배');
    expect(view.nodes.get('pe-samples')?.textContent).toBe('3');
    expect(view.nodes.get('forward-pe')?.textContent).toBe('18.00배');
    expect(view.nodes.get('peer-rows')?.children).toHaveLength(3);
    expect(view.nodes.get('chart-empty')?.textContent).toBe('No candles');
    expect(view.nodes.get('price-chart')?.hidden).toBe(true);
    expect(view.nodes.get('chart-summary')?.hidden).toBe(true);
  });

  test('renders untrusted strings as text and blocks unsafe URL schemes', () => {
    const view = testView();
    view.initialize();
    const report = fixtureReport('<img src=x onerror=alert(1)>');
    report.warnings = ['<script>execute()</script>'];
    report.valuation = fixtureValuation(report.ticker);
    report.valuation.company.sourceUrl = 'javascript:alert(1)';
    view.deliver({ report, dashboardUrl: 'javascript:alert(1)' });
    expect(view.nodes.get('ticker')?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(view.nodes.get('ticker')?.children).toHaveLength(0);
    expect(view.nodes.get('warnings')?.children[0]?.textContent).toBe('<script>execute()</script>');
    expect(view.nodes.get('valuation-source')?.children[0]?.tag).toBe('span');
    expect(view.nodes.get('dashboard-link')?.children[0]?.tag).toBe('span');
  });

  test('shows observed zero rates as zero and routes safe links through host open-link', () => {
    const view = testView();
    view.initialize();
    const report = fixtureReport('OII');
    report.historical.fixedHold.samples = 3;
    report.historical.fixedHold.winRatePct = 0;
    report.historical.atrBarriers.samples = 3;
    report.historical.atrBarriers.stopTouchRatePct = 0;
    report.historical.atrBarriers.targetTouchRatePct = 100;
    view.deliver({ report, dashboardUrl: 'http://localhost:5100/stock/OII' });
    expect(view.nodes.get('win-rate')?.textContent).toBe('0.00%');
    expect(view.nodes.get('stop-rate')?.textContent).toBe('0.00%');
    expect(view.nodes.get('target-rate')?.textContent).toBe('100.00%');
    let prevented = false;
    view.nodes.get('dashboard-link')?.children[0]?.listeners.get('click')?.({
      preventDefault() {
        prevented = true;
      },
    });
    expect(prevented).toBe(true);
    expect(view.messages.at(-1)?.message).toMatchObject({
      method: 'ui/open-link',
      params: { url: 'http://localhost:5100/stock/OII' },
    });
  });

  test('keeps target-provider currency separate from the stock quote currency', () => {
    const view = testView();
    view.initialize();
    const report = fixtureReport('OII');
    report.valuation = fixtureValuation('OII');
    report.valuation.company.currency = 'EUR';
    report.analystTargets.consensus = {
      source: 'Yahoo Finance',
      sourceUrl: 'https://finance.yahoo.com/quote/OII/analysis/',
      retrievedAt: report.generatedAt,
      mean: 52,
      median: 51,
      low: 40,
      high: 60,
      currency: 'USD',
      currentPrice: 45,
      meanUpsidePercent: 15.5,
      analystCount: 5,
      horizon: null,
      publishedAt: null,
    };
    view.deliver({ report });
    expect(view.nodes.get('target-mean')?.textContent).toBe('52.00 USD');
    expect(view.nodes.get('target-current')?.textContent).toContain('45.00 USD');
    report.analystTargets.consensus.currency = null;
    view.deliver({ report });
    expect(view.nodes.get('target-mean')?.textContent).toBe('52.00 통화 미제공');
  });

  test('supports line mode, range changes, keyboard OHLC and invalid candle filtering', () => {
    const view = testView();
    view.initialize();
    view.deliver({
      report: fixtureReport('OII'),
      chart: {
        ticker: 'OII',
        status: 'available',
        source: 'Yahoo Finance',
        candles: [
          candle('2026-02-30'),
          candle('2026-07-02', 200),
          candle('2026-09-02'),
          candle('2026-10-02', 103),
          { ...candle('2026-10-01'), high: 90 },
        ],
      },
    });
    const chart = view.nodes.get('price-chart')!;
    expect(chart.attributes['aria-label']).toContain('3거래일');
    expect(view.nodes.get('chart-summary')?.hidden).toBe(false);
    expect(view.nodes.get('chart-summary')?.textContent).toBe(
      '기간 2026-07-02 ~ 2026-10-02 · 저가 98.00 · 고가 200.00 · 3거래일'
    );
    expect(view.nodes.get('chart-readout')?.textContent).toContain('2026-10-02');
    chart.listeners.get('keydown')?.({ key: 'Home', preventDefault() {} });
    expect(view.nodes.get('chart-readout')?.textContent).toContain('2026-07-02');
    view.periods[0]?.listeners.get('click')?.({ preventDefault() {} });
    expect(chart.attributes['aria-label']).toContain('2거래일');
    expect(view.nodes.get('chart-summary')?.textContent).toBe(
      '기간 2026-09-02 ~ 2026-10-02 · 저가 98.00 · 고가 104.00 · 2거래일'
    );
    view.modes[1]?.listeners.get('click')?.({ preventDefault() {} });
    expect(chart.children.some((node) => node.tag === 'path')).toBe(true);
    expect(chart.attributes['aria-label']).toContain('일별 종가');
    expect(
      chart.children.some((node) =>
        Object.values(node.attributes).some((value) => /NaN|Infinity/.test(value))
      )
    ).toBe(false);
  });

  test('supports JSON text fallback, host theme changes and teardown', () => {
    const view = testView();
    view.initialize();
    view.dispatch({
      jsonrpc: '2.0',
      method: 'ui/notifications/tool-result',
      params: {
        content: [{ type: 'text', text: JSON.stringify({ report: fixtureReport('OII') }) }],
      },
    });
    expect(view.nodes.get('ticker')?.textContent).toBe('OII');
    view.dispatch({
      jsonrpc: '2.0',
      method: 'ui/notifications/host-context-changed',
      params: { theme: 'light' },
    });
    expect(view.root.dataset.theme).toBe('light');
    view.dispatch({
      jsonrpc: '2.0',
      id: 25,
      method: 'ui/resource-teardown',
      params: { reason: 'done' },
    });
    expect(view.messages.at(-1)?.message).toEqual({ jsonrpc: '2.0', id: 25, result: {} });
    view.deliver({ report: fixtureReport('AFTER') });
    expect(view.nodes.get('ticker')?.textContent).toBe('OII');
  });
});
