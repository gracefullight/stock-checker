// MCP Apps dashboard client. Served inline by dashboard-ui.ts, which transpiles
// this module with Bun at load time, so it must stay a self-contained browser
// script: type-only imports, no runtime imports, no build step, no network access.

import type { StockDashboardCandle, StockDashboardChart } from '@mcp/dashboard-data';
import type { StockAnalystReport } from '@stock-checker/core/src/reports/stock-analyst.ts';
import type { ValuationReport } from '@stock-checker/core/src/services/valuation.ts';

type Candle = StockDashboardCandle;
type Chart = StockDashboardChart;
type StockReport = StockAnalystReport;
type Valuation = ValuationReport;
type Payload = { report?: StockReport | null; chart?: Chart | null; dashboardUrl?: unknown };
/** Untrusted host frames: every field is checked before use. */
type HostMessage = {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  error?: unknown;
  result?: {
    protocolVersion?: unknown;
    hostCapabilities?: unknown;
    hostInfo?: { name?: unknown } | null;
    hostContext?: unknown;
  } | null;
  params?: {
    isError?: unknown;
    arguments?: { ticker?: unknown } | null;
    structuredContent?: { report?: unknown } | null;
    content?: unknown;
  } | null;
};

(() => {
  const $ = (id: string): HTMLElement => {
    const node = document.getElementById(id);
    if (!node) throw new Error(`Missing dashboard node: ${id}`);
    return node;
  };
  const text = (id: string, value: unknown) => {
    $(id).textContent = value == null ? '자료 없음' : String(value);
  };
  const numeric = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);
  const number = (value: unknown, digits = 2) =>
    numeric(value)
      ? value.toLocaleString('ko-KR', {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        })
      : '자료 없음';
  const count = (value: unknown) => (numeric(value) && value >= 0 ? number(value, 0) : '자료 없음');
  const multiple = (value: unknown) =>
    numeric(value) && value > 0 ? `${number(value)}배` : '자료 없음';
  const percentage = (value: unknown) => (numeric(value) ? `${number(value)}%` : '자료 없음');
  const element = (tag: string, value?: unknown, className?: string) => {
    const node = document.createElement(tag);
    if (value != null) node.textContent = String(value);
    if (className) node.className = className;
    return node;
  };
  let initialized = false;
  let parentOrigin: string | null = null;
  let hostCapabilities: Record<string, unknown> = {};
  let nextRequest = 2;
  let resizeObserver: ResizeObserver | undefined;
  let lastSize = '';
  let currency: string | null = null;
  let candles: Candle[] = [];
  let visibleCandles: Candle[] = [];
  let rangeMonths = 3;
  let chartType: 'candles' | 'line' = 'candles';
  let cursorIndex = -1;
  let cursor: Element | null = null;
  const plot = { left: 66, right: 884, top: 20, bottom: 266, volumeTop: 284, volumeBottom: 332 };
  const price = (value: unknown) =>
    number(value) + (numeric(value) && currency ? ` ${currency}` : '');
  try {
    const referrer = new URL(document.referrer);
    if (referrer.origin !== 'null') parentOrigin = referrer.origin;
  } catch {
    /* Opaque or referrer-free sandboxes pin the parent at the initialize response. */
  }
  const send = (message: Record<string, unknown>) =>
    window.parent.postMessage(
      { jsonrpc: '2.0', ...message },
      parentOrigin && parentOrigin !== 'null' ? parentOrigin : '*'
    );
  const notify = (method: string, params?: Record<string, unknown>) => {
    if (initialized) send({ method, ...(params ? { params } : {}) });
  };
  const safeUrl = (value: unknown) => {
    if (typeof value !== 'string') return null;
    try {
      const url = new URL(value);
      return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  };
  const link = (value: unknown, label?: string) => {
    const url = safeUrl(value);
    if (!url) return element('span', label || '출처 없음');
    const anchor = document.createElement('a');
    anchor.textContent = label || url;
    anchor.href = url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.addEventListener('click', (event) => {
      if (initialized && hostCapabilities.openLinks) {
        event.preventDefault();
        send({ id: nextRequest++, method: 'ui/open-link', params: { url } });
      }
    });
    return anchor;
  };
  const sizeChanged = () => {
    if (!initialized) return;
    const height = Math.ceil(document.body.getBoundingClientRect().height);
    const width = Math.ceil(document.documentElement.clientWidth);
    const key = `${width}:${height}`;
    if (key === lastSize || height <= 0 || width <= 0) return;
    lastSize = key;
    notify('ui/notifications/size-changed', { width, height });
  };
  const theme = (context: unknown) => {
    const value =
      context && typeof context === 'object' && 'theme' in context ? context.theme : undefined;
    if (value === 'dark' || value === 'light') {
      document.documentElement.dataset.theme = value;
    }
  };
  const list = (id: string, entries: unknown, fallback: string) => {
    const values: string[] = Array.isArray(entries)
      ? entries.filter((item: unknown): item is string => typeof item === 'string')
      : [];
    $(id).replaceChildren(
      ...(values.length ? values : [fallback]).map((value) => element('li', value))
    );
  };
  const svgNode = (tag: string, attributes: Record<string, string | number>, value?: unknown) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, attribute] of Object.entries(attributes))
      node.setAttribute(key, String(attribute));
    if (value != null) node.textContent = String(value);
    return node;
  };
  const validDate = (value: unknown): value is string =>
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  const validCandle = (candle: unknown): candle is Candle => {
    if (!candle || typeof candle !== 'object') return false;
    const { date, open, high, low, close, volume } = candle as Record<string, unknown>;
    if (!validDate(date)) return false;
    if (!numeric(open) || !numeric(high) || !numeric(low) || !numeric(close)) return false;
    return (
      open > 0 &&
      high > 0 &&
      low > 0 &&
      close > 0 &&
      high >= Math.max(open, close, low) &&
      low <= Math.min(open, close) &&
      numeric(volume) &&
      volume >= 0
    );
  };
  const showCandle = (index: number) => {
    if (!visibleCandles.length) return;
    cursorIndex = Math.min(Math.max(index, 0), visibleCandles.length - 1);
    const candle = visibleCandles[cursorIndex];
    text(
      'chart-readout',
      candle.date +
        ' · 시가 ' +
        price(candle.open) +
        ' · 고가 ' +
        price(candle.high) +
        ' · 저가 ' +
        price(candle.low) +
        ' · 종가 ' +
        price(candle.close) +
        ' · 거래량 ' +
        count(candle.volume)
    );
    if (cursor) {
      const x =
        plot.left + ((cursorIndex + 0.5) * (plot.right - plot.left)) / visibleCandles.length;
      cursor.setAttribute('x1', String(x));
      cursor.setAttribute('x2', String(x));
      cursor.setAttribute('visibility', 'visible');
    }
  };
  const buttons = (selector: string) => document.querySelectorAll<HTMLElement>(selector);
  /** `hidden` is an HTMLElement property; the SVG chart only honours the attribute. */
  const setHidden = (element: Element, flag: boolean) => {
    if ('hidden' in element) element.hidden = flag;
    if (typeof element.toggleAttribute === 'function') element.toggleAttribute('hidden', flag);
  };
  const drawChart = () => {
    const chart = $('price-chart');
    chart.replaceChildren();
    cursor = null;
    visibleCandles = [];
    for (const button of buttons('[data-months]')) {
      button.setAttribute('aria-pressed', String(Number(button.dataset.months) === rangeMonths));
    }
    for (const button of buttons('[data-chart-type]')) {
      button.setAttribute('aria-pressed', String(button.dataset.chartType === chartType));
    }
    if (!candles.length) {
      setHidden(chart, true);
      $('chart-readout').hidden = true;
      $('chart-summary').hidden = true;
      return;
    }
    const latest = new Date(`${candles[candles.length - 1].date}T00:00:00Z`);
    const start = new Date(latest);
    // Calendar-month boundary, clamped so March 31 minus one month stays in February.
    start.setUTCDate(1);
    start.setUTCMonth(start.getUTCMonth() - rangeMonths);
    const lastDay = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)
    ).getUTCDate();
    start.setUTCDate(Math.min(latest.getUTCDate(), lastDay));
    const startDate = start.toISOString().slice(0, 10);
    visibleCandles = candles.filter((candle) => candle.date >= startDate);
    setHidden(chart, false);
    $('chart-readout').hidden = false;
    $('chart-summary').hidden = false;
    const lows = visibleCandles.map((candle) => candle.low);
    const highs = visibleCandles.map((candle) => candle.high);
    const minimum = Math.min(...lows);
    const maximum = Math.max(...highs);
    const first = visibleCandles[0];
    const last = visibleCandles[visibleCandles.length - 1];
    // DOM text keeps the dates and observed price range readable when mobile scales the SVG.
    text(
      'chart-summary',
      '기간 ' +
        first.date +
        ' ~ ' +
        last.date +
        ' · 저가 ' +
        price(minimum) +
        ' · 고가 ' +
        price(maximum) +
        ' · ' +
        visibleCandles.length +
        '거래일'
    );
    const padding = Math.max((maximum - minimum) * 0.08, maximum * 0.002, 0.01);
    const lower = Math.max(0, minimum - padding);
    const upper = maximum + padding;
    const y = (value: number) =>
      plot.bottom - ((value - lower) / (upper - lower)) * (plot.bottom - plot.top);
    const width = (plot.right - plot.left) / visibleCandles.length;
    const maxVolume = Math.max(...visibleCandles.map((candle) => candle.volume), 1);
    const pieces: Element[] = [];
    for (let step = 0; step <= 4; step++) {
      const value = lower + ((upper - lower) * step) / 4;
      const level = y(value);
      pieces.push(
        svgNode('line', { x1: plot.left, x2: plot.right, y1: level, y2: level, class: 'gridline' })
      );
      pieces.push(
        svgNode(
          'text',
          { x: plot.left - 8, y: level + 4, 'text-anchor': 'end', class: 'axis' },
          number(value)
        )
      );
    }
    const path: string[] = [];
    visibleCandles.forEach((candle, index) => {
      const x = plot.left + (index + 0.5) * width;
      const className = candle.close >= candle.open ? 'up' : 'down';
      const bodyWidth = Math.max(0.8, Math.min(width * 0.72, 12));
      if (chartType === 'candles') {
        pieces.push(
          svgNode('line', { x1: x, x2: x, y1: y(candle.high), y2: y(candle.low), class: className })
        );
        pieces.push(
          svgNode('rect', {
            x: x - bodyWidth / 2,
            y: Math.min(y(candle.open), y(candle.close)),
            width: bodyWidth,
            height: Math.max(1, Math.abs(y(candle.open) - y(candle.close))),
            class: className,
          })
        );
      } else path.push(`${(index ? 'L' : 'M') + x} ${y(candle.close)}`);
      const volumeHeight = (candle.volume / maxVolume) * (plot.volumeBottom - plot.volumeTop);
      pieces.push(
        svgNode('rect', {
          x: x - bodyWidth / 2,
          y: plot.volumeBottom - volumeHeight,
          width: bodyWidth,
          height: volumeHeight,
          class: `volume ${className}`,
        })
      );
    });
    if (chartType === 'line')
      pieces.push(svgNode('path', { d: path.join(' '), class: 'price-line' }));
    pieces.push(svgNode('text', { x: plot.left, y: 354, class: 'axis' }, first.date));
    pieces.push(
      svgNode(
        'text',
        { x: plot.right, y: 354, 'text-anchor': 'end', class: 'axis' },
        latest.toISOString().slice(0, 10)
      )
    );
    cursor = svgNode('line', {
      x1: 0,
      x2: 0,
      y1: plot.top,
      y2: plot.volumeBottom,
      class: 'cursor',
      visibility: 'hidden',
    });
    pieces.push(cursor);
    chart.append(...pieces);
    chart.setAttribute(
      'aria-label',
      (chartType === 'candles' ? '일봉 캔들' : '일별 종가') +
        ' 및 거래량, ' +
        first.date +
        '부터 ' +
        last.date +
        ', ' +
        visibleCandles.length +
        '거래일. 좌우 방향키로 가격을 확인하세요.'
    );
    showCandle(visibleCandles.length - 1);
  };
  const renderValuation = (valuation: Valuation | null | undefined) => {
    const company = valuation?.company;
    const industry = valuation?.industryComparison;
    const relative = valuation?.relative;
    text('industry-name', company?.industry || '업종 자료 없음');
    text('stock-pe', multiple(company?.trailingPE));
    text('stock-psr', multiple(company?.psr));
    text('peer-pe', multiple(industry?.medianPE));
    text('peer-psr', multiple(industry?.medianPSR));
    text('pe-samples', count(industry?.peSamples));
    text('psr-samples', count(industry?.psrSamples));
    text('pe-premium', percentage(relative?.pePremiumPct));
    text('psr-premium', percentage(relative?.psrPremiumPct));
    text('forward-pe', multiple(company?.forwardPE));
    const reasons = [company?.peReason, company?.psrReason, industry?.reason].filter(
      (value) => typeof value === 'string'
    );
    text('valuation-reasons', reasons.join(' · ') || (valuation ? '' : '밸류에이션 자료 없음'));
    text(
      'valuation-time',
      valuation
        ? '조회 ' +
            (valuation.retrievedAt || '자료 없음') +
            ' · 제공자 시세 기준 ' +
            (company?.priceAsOf || '자료 없음')
        : '조회 시점 자료 없음'
    );
    text('valuation-method', industry?.method || '산출 기준 자료 없음');
    text('valuation-universe', industry?.universe || '표본 범위 자료 없음');
    $('valuation-source').replaceChildren(
      link(company?.sourceUrl, '종목 출처'),
      element('span', ' · '),
      link(industry?.sourceUrl, '동종기업 표본 출처')
    );
    const peers = industry && Array.isArray(industry.peers) ? industry.peers.slice(0, 12) : [];
    $('peer-rows').replaceChildren(
      ...peers.map((peer) => {
        const row = element('tr');
        row.append(
          element('td', peer.ticker),
          element('td', multiple(peer.trailingPE)),
          element('td', multiple(peer.psr))
        );
        return row;
      })
    );
    const coverage = industry?.coverage;
    text(
      'peer-coverage',
      coverage
        ? '동일 업종 ' +
            count(coverage.matchingIndustryCount) +
            '개 / 조회 ' +
            count(coverage.requestedCount) +
            '개 · 조회 실패 ' +
            count(coverage.failedRequests) +
            '개'
        : '표본 없음'
    );
  };
  const render = (payload: Payload) => {
    const report = payload?.report;
    if (!report || typeof report.ticker !== 'string') {
      pending();
      text('status', '리포트 자료를 받지 못했습니다.');
      sizeChanged();
      return;
    }
    const current = report.current;
    const reference = report.execution?.reference;
    const consensus = report.analystTargets?.consensus;
    const targetPrice = (value: unknown) =>
      number(value) + (numeric(value) ? ` ${consensus?.currency || '통화 미제공'}` : '');
    currency = report.valuation?.company?.currency || consensus?.currency || null;
    text('ticker', report.ticker);
    const decision = current?.decision;
    text('decision', decision || '자료 없음');
    $('decision').dataset.decision =
      decision === 'BUY' || decision === 'SELL' || decision === 'HOLD' ? decision : 'unavailable';
    text('latest-price', price(reference?.price));
    text('price-date', `완료 거래일 ${report.dataAsOf || '자료 없음'}`);
    text('report-time', `리포트 생성 ${report.generatedAt || '자료 없음'}`);
    text('status', report.status === 'available' ? '완료 거래일 기준 분석' : '가격 분석 자료 없음');
    text('buy-score', number(current?.buyScore));
    text('sell-score', number(current?.sellScore));
    text(
      'entry-status',
      report.execution?.entry?.eligible
        ? 'BUY 조건 통과 · 다음 거래일 시가 진입 조건부'
        : '신규 BUY 조건 미충족'
    );
    text('entry-price', '실제 진입가: 아직 알 수 없음');
    text('atr', price(reference?.atr));
    text('stop', price(reference?.stopLoss));
    text('target', price(reference?.takeProfit));
    list('gate-reasons', current?.gateReasons, '신호 근거 자료 없음');
    const fixed = report.historical?.fixedHold;
    const barriers = report.historical?.atrBarriers;
    text('win-rate', percentage(fixed && fixed.samples > 0 ? fixed.winRatePct : null));
    text('win-count', `${count(fixed?.wins)} / ${count(fixed?.samples)}표본`);
    text(
      'stop-rate',
      percentage(barriers && barriers.samples > 0 ? barriers.stopTouchRatePct : null)
    );
    text('stop-count', `${count(barriers?.stopTouched)} / ${count(barriers?.samples)}표본`);
    text(
      'target-rate',
      percentage(barriers && barriers.samples > 0 ? barriers.targetTouchRatePct : null)
    );
    text('target-count', `${count(barriers?.targetTouched)} / ${count(barriers?.samples)}표본`);
    text(
      'history-method',
      'BUY 다음 거래일 시가 진입 · ' +
        count(report.historical?.method?.horizonSessions) +
        '거래일 보유 · 왕복 비용 ' +
        count(report.historical?.method?.roundTripCostBps) +
        'bps · 중복 관측 허용'
    );
    text(
      'history-period',
      `${report.historical?.period?.from || '자료 없음'} ~ ${report.historical?.period?.to || '자료 없음'}`
    );
    text(
      'barrier-detail',
      '손절·목표 모두 도달 ' +
        count(barriers?.bothTouched) +
        '건 · 동일 일봉의 선후 불명 ' +
        count(barriers?.ambiguousFirstTouch) +
        '건'
    );
    renderValuation(report.valuation);
    text('target-mean', targetPrice(consensus?.mean));
    text('target-median', targetPrice(consensus?.median));
    text('target-range', `${targetPrice(consensus?.low)} ~ ${targetPrice(consensus?.high)}`);
    text('analyst-count', count(consensus?.analystCount));
    text('target-upside', percentage(consensus?.meanUpsidePercent));
    text(
      'target-current',
      `상승 여력 계산에 사용한 제공자 시세 ${targetPrice(consensus?.currentPrice)}`
    );
    text(
      'target-time',
      consensus ? `조회 ${consensus.retrievedAt || '자료 없음'}` : '목표가 자료 없음'
    );
    $('target-source').replaceChildren(
      link(consensus?.sourceUrl, consensus?.source || '목표가 출처 없음')
    );
    const recent = report.analystTargets?.recent;
    text(
      'recent-summary',
      '최근 ' +
        count(recent?.windowDays) +
        '일 기록 ' +
        (Array.isArray(recent?.updates) ? recent.updates.length : 0) +
        '건 · 30일 기록 ' +
        count(recent?.count30Days) +
        '건'
    );
    const updates = recent && Array.isArray(recent.updates) ? recent.updates.slice(0, 5) : [];
    $('analyst-updates').replaceChildren(
      ...updates.map((update) => {
        const node = element('li');
        node.append(
          element(
            'span',
            (update.publishedAt || '날짜 없음') +
              ' · ' +
              (update.firm || '기관 없음') +
              ' · ' +
              number(update.priorTargetPrice) +
              ' → ' +
              number(update.targetPrice) +
              ' ' +
              (update.currency || '통화 미제공') +
              ' · '
          ),
          link(update.sourceUrl, update.source || '출처 없음')
        );
        return node;
      })
    );
    text('recent-reason', updates.length ? '' : recent?.reason || '최근 목표가 변경 자료 없음');
    list('warnings', report.warnings, '추가 제한사항 없음');
    $('dashboard-link').replaceChildren(
      payload.dashboardUrl
        ? link(payload.dashboardUrl, '전체 대시보드 열기 ↗')
        : element('span', '')
    );
    const chart = payload.chart;
    const inputCandles =
      chart?.status === 'available' &&
      chart.ticker === report.ticker &&
      Array.isArray(chart.candles)
        ? chart.candles.filter(validCandle).slice(-300)
        : [];
    const unique = new Map<string, Candle>();
    for (const candle of inputCandles) unique.set(candle.date, candle);
    candles = [...unique.values()].sort((a, b) => a.date.localeCompare(b.date));
    text('chart-source', chart?.source || '차트 출처 자료 없음');
    text('chart-empty', candles.length ? '' : chart?.reason || '완료 일봉 차트 자료 없음');
    $('chart-controls').hidden = !candles.length;
    drawChart();
    $('dashboard').hidden = false;
    sizeChanged();
  };
  const resultPayload = (params: HostMessage['params']): Payload | null => {
    if (params?.structuredContent?.report) return params.structuredContent as Payload;
    for (const item of Array.isArray(params?.content) ? params.content : []) {
      if (item.type !== 'text' || typeof item.text !== 'string') continue;
      try {
        const value = JSON.parse(item.text);
        if (value?.report) return value;
      } catch {
        /* Markdown is not JSON. */
      }
    }
    return null;
  };
  const pending = () => {
    $('dashboard').hidden = true;
    text('latest-price', '—');
    text('decision', '대기');
    $('decision').dataset.decision = 'unavailable';
    text('price-date', '완료 거래일 자료 대기');
    text('report-time', '');
    $('dashboard-link').replaceChildren();
  };
  const receive = (event: MessageEvent) => {
    if (event.source !== window.parent || (parentOrigin !== null && event.origin !== parentOrigin))
      return;
    const message = event.data as HostMessage;
    if (message?.jsonrpc !== '2.0' || typeof message !== 'object') return;
    if (!initialized) {
      if (message.id !== 1 || message.method) return;
      const result = message.result;
      if (
        message.error ||
        result?.protocolVersion !== '2026-01-26' ||
        typeof result.hostCapabilities !== 'object' ||
        !result.hostCapabilities ||
        typeof result.hostInfo?.name !== 'string'
      ) {
        text('status', 'MCP Apps 연결을 초기화하지 못했습니다.');
        return;
      }
      parentOrigin = event.origin;
      hostCapabilities = result.hostCapabilities as Record<string, unknown>;
      theme(result.hostContext);
      initialized = true;
      send({ method: 'ui/notifications/initialized' });
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(sizeChanged);
        resizeObserver.observe(document.body);
      }
      sizeChanged();
      return;
    }
    if (message.method === 'ui/notifications/tool-result') {
      const payload = resultPayload(message.params);
      if (payload) render(payload);
      else {
        pending();
        text(
          'status',
          message.params?.isError
            ? '종목 분석을 완료하지 못했습니다.'
            : '표시할 리포트 자료가 없습니다.'
        );
        sizeChanged();
      }
    } else if (message.method === 'ui/notifications/tool-input') {
      pending();
      if (typeof message.params?.arguments?.ticker === 'string')
        text('ticker', message.params.arguments.ticker);
      text('status', '종목 자료를 불러오는 중…');
      sizeChanged();
    } else if (message.method === 'ui/notifications/tool-cancelled') {
      pending();
      text('status', '종목 분석이 취소됐습니다.');
      sizeChanged();
    } else if (message.method === 'ui/notifications/host-context-changed') {
      theme(message.params);
    } else if (message.method === 'ping' && message.id != null) {
      send({ id: message.id, result: {} });
    } else if (message.method === 'ui/resource-teardown' && message.id != null) {
      resizeObserver?.disconnect();
      window.removeEventListener('message', receive);
      send({ id: message.id, result: {} });
    }
  };
  for (const button of buttons('[data-months]')) {
    button.addEventListener('click', () => {
      rangeMonths = Number(button.dataset.months);
      drawChart();
    });
  }
  for (const button of buttons('[data-chart-type]')) {
    button.addEventListener('click', () => {
      chartType = button.dataset.chartType === 'line' ? 'line' : 'candles';
      drawChart();
    });
  }
  $('price-chart').addEventListener('pointermove', (event) => {
    const rect = $('price-chart').getBoundingClientRect();
    if (!rect.width || !visibleCandles.length) return;
    const x = ((event.clientX - rect.left) / rect.width) * 900;
    showCandle(Math.floor(((x - plot.left) / (plot.right - plot.left)) * visibleCandles.length));
  });
  $('price-chart').addEventListener('keydown', (event) => {
    if (!visibleCandles.length || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
      return;
    event.preventDefault();
    showCandle(
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? visibleCandles.length - 1
          : cursorIndex + (event.key === 'ArrowLeft' ? -1 : 1)
    );
  });
  window.addEventListener('message', receive);
  if (window.parent === window) {
    text('status', 'MCP Apps를 지원하는 채팅에서 이 대시보드를 열어주세요.');
  } else
    send({
      id: 1,
      method: 'ui/initialize',
      params: {
        protocolVersion: '2026-01-26',
        appInfo: { name: 'Stock Checker Dashboard', version: '1.0.0' },
        appCapabilities: { availableDisplayModes: ['inline'] },
      },
    });
})();
