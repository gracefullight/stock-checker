/** MCP Apps stable protocol: https://github.com/modelcontextprotocol/ext-apps/tree/main/specification/2026-01-26 */
export const DASHBOARD_RESOURCE_URI = 'ui://stock-checker/dashboard';
export const DASHBOARD_MIME_TYPE = 'text/html;profile=mcp-app';
export const DASHBOARD_RESOURCE_META = {
  ui: {
    csp: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] },
    prefersBorder: true,
  },
};

// Plain JavaScript is served directly: the resource needs no build or network assets.
export const dashboardUiScript = String.raw`
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const text = (id, value) => { $(id).textContent = value == null ? '자료 없음' : String(value); };
  const numeric = (value) => typeof value === 'number' && Number.isFinite(value);
  const number = (value, digits = 2) => numeric(value)
    ? value.toLocaleString('ko-KR', {minimumFractionDigits: digits, maximumFractionDigits: digits}) : '자료 없음';
  const count = (value) => numeric(value) && value >= 0 ? number(value, 0) : '자료 없음';
  const multiple = (value) => numeric(value) && value > 0 ? number(value) + '배' : '자료 없음';
  const percentage = (value) => numeric(value) ? number(value) + '%' : '자료 없음';
  const element = (tag, value, className) => {
    const node = document.createElement(tag);
    if (value != null) node.textContent = String(value);
    if (className) node.className = className;
    return node;
  };
  let initialized = false;
  let parentOrigin = null;
  let hostCapabilities = {};
  let nextRequest = 2;
  let resizeObserver;
  let lastSize = '';
  let currency = null;
  let candles = [];
  let visibleCandles = [];
  let rangeMonths = 3;
  let chartType = 'candles';
  let cursorIndex = -1;
  let cursor;
  const plot = {left: 66, right: 884, top: 20, bottom: 266, volumeTop: 284, volumeBottom: 332};
  const price = (value) => number(value) + (numeric(value) && currency ? ' ' + currency : '');
  try {
    const referrer = new URL(document.referrer);
    if (referrer.origin !== 'null') parentOrigin = referrer.origin;
  } catch { /* Opaque or referrer-free sandboxes pin the parent at the initialize response. */ }
  const send = (message) => window.parent.postMessage(
    {jsonrpc: '2.0', ...message}, parentOrigin && parentOrigin !== 'null' ? parentOrigin : '*'
  );
  const notify = (method, params) => { if (initialized) send({method, ...(params ? {params} : {})}); };
  const safeUrl = (value) => {
    if (typeof value !== 'string') return null;
    try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; }
    catch { return null; }
  };
  const link = (value, label) => {
    const url = safeUrl(value);
    if (!url) return element('span', label || '출처 없음');
    const anchor = element('a', label || url);
    anchor.href = url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.addEventListener('click', (event) => {
      if (initialized && hostCapabilities.openLinks) {
        event.preventDefault();
        send({id: nextRequest++, method: 'ui/open-link', params: {url}});
      }
    });
    return anchor;
  };
  const sizeChanged = () => {
    if (!initialized) return;
    const height = Math.ceil(document.body.getBoundingClientRect().height);
    const width = Math.ceil(document.documentElement.clientWidth);
    const key = width + ':' + height;
    if (key === lastSize || height <= 0 || width <= 0) return;
    lastSize = key;
    notify('ui/notifications/size-changed', {width, height});
  };
  const theme = (context) => {
    if (context?.theme === 'dark' || context?.theme === 'light') {
      document.documentElement.dataset.theme = context.theme;
    }
  };
  const list = (id, entries, fallback) => {
    const values = Array.isArray(entries) ? entries.filter((item) => typeof item === 'string') : [];
    $(id).replaceChildren(...(values.length ? values : [fallback]).map((value) => element('li', value)));
  };
  const svgNode = (tag, attributes, value) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, attribute] of Object.entries(attributes)) node.setAttribute(key, String(attribute));
    if (value != null) node.textContent = String(value);
    return node;
  };
  const validDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value + 'T00:00:00Z'))
    && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
  const validCandle = (candle) => candle && validDate(candle.date)
    && [candle.open, candle.high, candle.low, candle.close].every((value) => numeric(value) && value > 0)
    && candle.high >= Math.max(candle.open, candle.close, candle.low)
    && candle.low <= Math.min(candle.open, candle.close) && numeric(candle.volume) && candle.volume >= 0;
  const showCandle = (index) => {
    if (!visibleCandles.length) return;
    cursorIndex = Math.min(Math.max(index, 0), visibleCandles.length - 1);
    const candle = visibleCandles[cursorIndex];
    text('chart-readout', candle.date + ' · 시가 ' + price(candle.open) + ' · 고가 ' + price(candle.high)
      + ' · 저가 ' + price(candle.low) + ' · 종가 ' + price(candle.close) + ' · 거래량 ' + count(candle.volume));
    if (cursor) {
      const x = plot.left + (cursorIndex + 0.5) * (plot.right - plot.left) / visibleCandles.length;
      cursor.setAttribute('x1', String(x));
      cursor.setAttribute('x2', String(x));
      cursor.setAttribute('visibility', 'visible');
    }
  };
  const drawChart = () => {
    const chart = $('price-chart');
    chart.replaceChildren();
    cursor = null;
    visibleCandles = [];
    for (const button of document.querySelectorAll('[data-months]')) {
      button.setAttribute('aria-pressed', String(Number(button.dataset.months) === rangeMonths));
    }
    for (const button of document.querySelectorAll('[data-chart-type]')) {
      button.setAttribute('aria-pressed', String(button.dataset.chartType === chartType));
    }
    if (!candles.length) {
      chart.hidden = true;
      $('chart-readout').hidden = true;
      $('chart-summary').hidden = true;
      return;
    }
    const latest = new Date(candles[candles.length - 1].date + 'T00:00:00Z');
    const start = new Date(latest);
    // Calendar-month boundary, clamped so March 31 minus one month stays in February.
    start.setUTCDate(1);
    start.setUTCMonth(start.getUTCMonth() - rangeMonths);
    const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
    start.setUTCDate(Math.min(latest.getUTCDate(), lastDay));
    const startDate = start.toISOString().slice(0, 10);
    visibleCandles = candles.filter((candle) => candle.date >= startDate);
    chart.hidden = false;
    $('chart-readout').hidden = false;
    $('chart-summary').hidden = false;
    const lows = visibleCandles.map((candle) => candle.low);
    const highs = visibleCandles.map((candle) => candle.high);
    const minimum = Math.min(...lows);
    const maximum = Math.max(...highs);
    // DOM text keeps the dates and observed price range readable when mobile scales the SVG.
    text('chart-summary', '기간 ' + visibleCandles[0].date + ' ~ '
      + visibleCandles[visibleCandles.length - 1].date + ' · 저가 ' + price(minimum)
      + ' · 고가 ' + price(maximum) + ' · ' + visibleCandles.length + '거래일');
    const padding = Math.max((maximum - minimum) * 0.08, maximum * 0.002, 0.01);
    const lower = Math.max(0, minimum - padding);
    const upper = maximum + padding;
    const y = (value) => plot.bottom - (value - lower) / (upper - lower) * (plot.bottom - plot.top);
    const width = (plot.right - plot.left) / visibleCandles.length;
    const maxVolume = Math.max(...visibleCandles.map((candle) => candle.volume), 1);
    const pieces = [];
    for (let step = 0; step <= 4; step++) {
      const value = lower + (upper - lower) * step / 4;
      const level = y(value);
      pieces.push(svgNode('line', {x1: plot.left, x2: plot.right, y1: level, y2: level, class: 'gridline'}));
      pieces.push(svgNode('text', {x: plot.left - 8, y: level + 4, 'text-anchor': 'end', class: 'axis'}, number(value)));
    }
    const path = [];
    visibleCandles.forEach((candle, index) => {
      const x = plot.left + (index + 0.5) * width;
      const className = candle.close >= candle.open ? 'up' : 'down';
      const bodyWidth = Math.max(0.8, Math.min(width * 0.72, 12));
      if (chartType === 'candles') {
        pieces.push(svgNode('line', {x1: x, x2: x, y1: y(candle.high), y2: y(candle.low), class: className}));
        pieces.push(svgNode('rect', {x: x - bodyWidth / 2, y: Math.min(y(candle.open), y(candle.close)),
          width: bodyWidth, height: Math.max(1, Math.abs(y(candle.open) - y(candle.close))), class: className}));
      } else path.push((index ? 'L' : 'M') + x + ' ' + y(candle.close));
      const volumeHeight = candle.volume / maxVolume * (plot.volumeBottom - plot.volumeTop);
      pieces.push(svgNode('rect', {x: x - bodyWidth / 2, y: plot.volumeBottom - volumeHeight,
        width: bodyWidth, height: volumeHeight, class: 'volume ' + className}));
    });
    if (chartType === 'line') pieces.push(svgNode('path', {d: path.join(' '), class: 'price-line'}));
    pieces.push(svgNode('text', {x: plot.left, y: 354, class: 'axis'}, visibleCandles[0].date));
    pieces.push(svgNode('text', {x: plot.right, y: 354, 'text-anchor': 'end', class: 'axis'}, latest.toISOString().slice(0, 10)));
    cursor = svgNode('line', {x1: 0, x2: 0, y1: plot.top, y2: plot.volumeBottom, class: 'cursor', visibility: 'hidden'});
    pieces.push(cursor);
    chart.append(...pieces);
    chart.setAttribute('aria-label', (chartType === 'candles' ? '일봉 캔들' : '일별 종가') + ' 및 거래량, '
      + visibleCandles[0].date + '부터 ' + visibleCandles[visibleCandles.length - 1].date
      + ', ' + visibleCandles.length + '거래일. 좌우 방향키로 가격을 확인하세요.');
    showCandle(visibleCandles.length - 1);
  };
  const renderValuation = (valuation) => {
    const company = valuation?.company || {};
    const industry = valuation?.industryComparison || {};
    const relative = valuation?.relative || {};
    text('industry-name', company.industry || '업종 자료 없음');
    text('stock-pe', multiple(company.trailingPE));
    text('stock-psr', multiple(company.psr));
    text('peer-pe', multiple(industry.medianPE));
    text('peer-psr', multiple(industry.medianPSR));
    text('pe-samples', count(industry.peSamples));
    text('psr-samples', count(industry.psrSamples));
    text('pe-premium', percentage(relative.pePremiumPct));
    text('psr-premium', percentage(relative.psrPremiumPct));
    text('forward-pe', multiple(company.forwardPE));
    const reasons = [company.peReason, company.psrReason, industry.reason].filter((value) => typeof value === 'string');
    text('valuation-reasons', reasons.join(' · ') || (valuation ? '' : '밸류에이션 자료 없음'));
    text('valuation-time', valuation ? '조회 ' + (valuation.retrievedAt || '자료 없음')
      + ' · 제공자 시세 기준 ' + (company.priceAsOf || '자료 없음') : '조회 시점 자료 없음');
    text('valuation-method', industry.method || '산출 기준 자료 없음');
    text('valuation-universe', industry.universe || '표본 범위 자료 없음');
    $('valuation-source').replaceChildren(link(company.sourceUrl, '종목 출처'), element('span', ' · '),
      link(industry.sourceUrl, '동종기업 표본 출처'));
    const peers = Array.isArray(industry.peers) ? industry.peers.slice(0, 12) : [];
    $('peer-rows').replaceChildren(...peers.map((peer) => {
      const row = element('tr');
      row.append(element('td', peer.ticker), element('td', multiple(peer.trailingPE)), element('td', multiple(peer.psr)));
      return row;
    }));
    text('peer-coverage', industry.coverage ? '동일 업종 ' + count(industry.coverage.matchingIndustryCount)
      + '개 / 조회 ' + count(industry.coverage.requestedCount) + '개 · 조회 실패 '
      + count(industry.coverage.failedRequests) + '개' : '표본 없음');
  };
  const render = (payload) => {
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
    const targetPrice = (value) => number(value) + (numeric(value) ? ' ' + (consensus?.currency || '통화 미제공') : '');
    currency = report.valuation?.company?.currency || consensus?.currency || null;
    text('ticker', report.ticker);
    text('decision', current?.decision || '자료 없음');
    $('decision').dataset.decision = ['BUY', 'SELL', 'HOLD'].includes(current?.decision) ? current.decision : 'unavailable';
    text('latest-price', price(reference?.price));
    text('price-date', '완료 거래일 ' + (report.dataAsOf || '자료 없음'));
    text('report-time', '리포트 생성 ' + (report.generatedAt || '자료 없음'));
    text('status', report.status === 'available' ? '완료 거래일 기준 분석' : '가격 분석 자료 없음');
    text('buy-score', number(current?.buyScore));
    text('sell-score', number(current?.sellScore));
    text('entry-status', report.execution?.entry?.eligible ? 'BUY 조건 통과 · 다음 거래일 시가 진입 조건부' : '신규 BUY 조건 미충족');
    text('entry-price', '실제 진입가: 아직 알 수 없음');
    text('atr', price(reference?.atr));
    text('stop', price(reference?.stopLoss));
    text('target', price(reference?.takeProfit));
    list('gate-reasons', current?.gateReasons, '신호 근거 자료 없음');
    const fixed = report.historical?.fixedHold || {};
    const barriers = report.historical?.atrBarriers || {};
    text('win-rate', percentage(fixed.samples > 0 ? fixed.winRatePct : null));
    text('win-count', count(fixed.wins) + ' / ' + count(fixed.samples) + '표본');
    text('stop-rate', percentage(barriers.samples > 0 ? barriers.stopTouchRatePct : null));
    text('stop-count', count(barriers.stopTouched) + ' / ' + count(barriers.samples) + '표본');
    text('target-rate', percentage(barriers.samples > 0 ? barriers.targetTouchRatePct : null));
    text('target-count', count(barriers.targetTouched) + ' / ' + count(barriers.samples) + '표본');
    text('history-method', 'BUY 다음 거래일 시가 진입 · ' + count(report.historical?.method?.horizonSessions)
      + '거래일 보유 · 왕복 비용 ' + count(report.historical?.method?.roundTripCostBps) + 'bps · 중복 관측 허용');
    text('history-period', (report.historical?.period?.from || '자료 없음') + ' ~ ' + (report.historical?.period?.to || '자료 없음'));
    text('barrier-detail', '손절·목표 모두 도달 ' + count(barriers.bothTouched)
      + '건 · 동일 일봉의 선후 불명 ' + count(barriers.ambiguousFirstTouch) + '건');
    renderValuation(report.valuation);
    text('target-mean', targetPrice(consensus?.mean));
    text('target-median', targetPrice(consensus?.median));
    text('target-range', targetPrice(consensus?.low) + ' ~ ' + targetPrice(consensus?.high));
    text('analyst-count', count(consensus?.analystCount));
    text('target-upside', percentage(consensus?.meanUpsidePercent));
    text('target-current', '상승 여력 계산에 사용한 제공자 시세 ' + targetPrice(consensus?.currentPrice));
    text('target-time', consensus ? '조회 ' + (consensus.retrievedAt || '자료 없음') : '목표가 자료 없음');
    $('target-source').replaceChildren(link(consensus?.sourceUrl, consensus?.source || '목표가 출처 없음'));
    const recent = report.analystTargets?.recent;
    text('recent-summary', '최근 ' + count(recent?.windowDays) + '일 기록 '
      + (Array.isArray(recent?.updates) ? recent.updates.length : 0) + '건 · 30일 기록 ' + count(recent?.count30Days) + '건');
    const updates = Array.isArray(recent?.updates) ? recent.updates.slice(0, 5) : [];
    $('analyst-updates').replaceChildren(...updates.map((update) => {
      const node = element('li');
      node.append(element('span', (update.publishedAt || '날짜 없음') + ' · ' + (update.firm || '기관 없음')
        + ' · ' + number(update.priorTargetPrice) + ' → ' + number(update.targetPrice)
        + ' ' + (update.currency || '통화 미제공') + ' · '), link(update.sourceUrl, update.source || '출처 없음'));
      return node;
    }));
    text('recent-reason', updates.length ? '' : recent?.reason || '최근 목표가 변경 자료 없음');
    list('warnings', report.warnings, '추가 제한사항 없음');
    $('dashboard-link').replaceChildren(payload.dashboardUrl ? link(payload.dashboardUrl, '전체 대시보드 열기 ↗') : element('span', ''));
    const chart = payload.chart;
    const inputCandles = chart?.status === 'available' && chart.ticker === report.ticker && Array.isArray(chart.candles)
      ? chart.candles.filter(validCandle).slice(-300) : [];
    const unique = new Map(inputCandles.map((candle) => [candle.date, candle]));
    candles = [...unique.values()].sort((a, b) => a.date.localeCompare(b.date));
    text('chart-source', chart?.source || '차트 출처 자료 없음');
    text('chart-empty', candles.length ? '' : chart?.reason || '완료 일봉 차트 자료 없음');
    $('chart-controls').hidden = !candles.length;
    drawChart();
    $('dashboard').hidden = false;
    sizeChanged();
  };
  const resultPayload = (params) => {
    if (params?.structuredContent?.report) return params.structuredContent;
    for (const item of Array.isArray(params?.content) ? params.content : []) {
      if (item.type !== 'text' || typeof item.text !== 'string') continue;
      try { const value = JSON.parse(item.text); if (value?.report) return value; } catch { /* Markdown is not JSON. */ }
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
  const receive = (event) => {
    if (event.source !== window.parent || (parentOrigin !== null && event.origin !== parentOrigin)) return;
    const message = event.data;
    if (!message || message.jsonrpc !== '2.0' || typeof message !== 'object') return;
    if (!initialized) {
      if (message.id !== 1 || message.method) return;
      if (message.error || message.result?.protocolVersion !== '2026-01-26'
        || typeof message.result?.hostCapabilities !== 'object' || !message.result.hostCapabilities
        || typeof message.result?.hostInfo?.name !== 'string') {
        text('status', 'MCP Apps 연결을 초기화하지 못했습니다.');
        return;
      }
      parentOrigin = event.origin;
      hostCapabilities = message.result.hostCapabilities;
      theme(message.result.hostContext);
      initialized = true;
      send({method: 'ui/notifications/initialized'});
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
        text('status', message.params?.isError ? '종목 분석을 완료하지 못했습니다.' : '표시할 리포트 자료가 없습니다.');
        sizeChanged();
      }
    } else if (message.method === 'ui/notifications/tool-input') {
      pending();
      if (typeof message.params?.arguments?.ticker === 'string') text('ticker', message.params.arguments.ticker);
      text('status', '종목 자료를 불러오는 중…');
      sizeChanged();
    } else if (message.method === 'ui/notifications/tool-cancelled') {
      pending();
      text('status', '종목 분석이 취소됐습니다.');
      sizeChanged();
    } else if (message.method === 'ui/notifications/host-context-changed') {
      theme(message.params);
    } else if (message.method === 'ping' && message.id != null) {
      send({id: message.id, result: {}});
    } else if (message.method === 'ui/resource-teardown' && message.id != null) {
      resizeObserver?.disconnect();
      window.removeEventListener('message', receive);
      send({id: message.id, result: {}});
    }
  };
  for (const button of document.querySelectorAll('[data-months]')) {
    button.addEventListener('click', () => { rangeMonths = Number(button.dataset.months); drawChart(); });
  }
  for (const button of document.querySelectorAll('[data-chart-type]')) {
    button.addEventListener('click', () => { chartType = button.dataset.chartType; drawChart(); });
  }
  $('price-chart').addEventListener('pointermove', (event) => {
    const rect = $('price-chart').getBoundingClientRect();
    if (!rect.width || !visibleCandles.length) return;
    const x = (event.clientX - rect.left) / rect.width * 900;
    showCandle(Math.floor((x - plot.left) / (plot.right - plot.left) * visibleCandles.length));
  });
  $('price-chart').addEventListener('keydown', (event) => {
    if (!visibleCandles.length || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    showCandle(event.key === 'Home' ? 0 : event.key === 'End' ? visibleCandles.length - 1
      : cursorIndex + (event.key === 'ArrowLeft' ? -1 : 1));
  });
  window.addEventListener('message', receive);
  if (window.parent === window) {
    text('status', 'MCP Apps를 지원하는 채팅에서 이 대시보드를 열어주세요.');
  } else send({id: 1, method: 'ui/initialize', params: {
    protocolVersion: '2026-01-26', appInfo: {name: 'Stock Checker Dashboard', version: '1.0.0'},
    appCapabilities: {availableDisplayModes: ['inline']}
  }});
})();
`;

export const dashboardHtml = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'">
<title>Stock Checker 종목 대시보드</title>
<style>
:root{color-scheme:light dark;--background:oklch(1 0 0);--foreground:oklch(.145 0 0);--card:oklch(.985 0 0);--muted-foreground:oklch(.48 0 0);--border:oklch(.9 0 0);--primary:oklch(.5 .15 220);--success:oklch(.48 .15 145);--destructive:oklch(.53 .21 27);--warning:oklch(.48 .1 75)}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]){--background:oklch(.145 0 0);--foreground:oklch(.92 0 0);--card:oklch(.185 0 0);--muted-foreground:oklch(.7 0 0);--border:oklch(.28 0 0);--primary:oklch(.72 .14 220);--success:oklch(.75 .2 145);--destructive:oklch(.7 .21 27);--warning:oklch(.87 .17 85)}}
:root[data-theme=dark]{color-scheme:dark;--background:oklch(.145 0 0);--foreground:oklch(.92 0 0);--card:oklch(.185 0 0);--muted-foreground:oklch(.7 0 0);--border:oklch(.28 0 0);--primary:oklch(.72 .14 220);--success:oklch(.75 .2 145);--destructive:oklch(.7 .21 27);--warning:oklch(.87 .17 85)}
:root[data-theme=light]{color-scheme:light}*{box-sizing:border-box}body{margin:0;padding:16px;background:var(--background);color:var(--foreground);font:16px/1.5 system-ui,-apple-system,sans-serif}main{max-width:1120px;margin:auto}[hidden]{display:none!important}h1,h2,h3,p{margin:0}h1{font-size:24px}h2{font-size:17px;margin-bottom:12px}h3{font-size:15px;margin-bottom:8px}header{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;margin-bottom:16px}.title-row{display:flex;align-items:center;gap:12px}.price{font-size:28px;font-weight:650}.mono,.value,td:not(:first-child){font-family:ui-monospace,monospace;font-variant-numeric:tabular-nums}.muted{font-size:13px;color:var(--muted-foreground)}.badge{font-size:13px;font-weight:700;border:1px solid var(--border);border-radius:6px;padding:3px 8px}.badge[data-decision=BUY]{color:var(--success)}.badge[data-decision=SELL]{color:var(--destructive)}.badge[data-decision=HOLD]{color:var(--warning)}.panel{border:1px solid var(--border);border-radius:8px;padding:16px;margin-bottom:16px;background:var(--card);min-width:0}.grid{display:grid;gap:16px;grid-template-columns:1fr}.metrics{display:grid;gap:16px;grid-template-columns:repeat(2,minmax(0,1fr))}.metric dt{font-size:13px;color:var(--muted-foreground)}.metric dd{margin:4px 0 0;overflow-wrap:anywhere}.value{font-size:19px;font-weight:600}dl{margin:0}.chart-header{display:flex;gap:12px;flex-wrap:wrap;justify-content:space-between;align-items:center}.controls{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px}.control-group{display:flex;gap:4px}button{font:inherit;font-size:13px;background:var(--background);color:var(--foreground);border:1px solid var(--border);border-radius:5px;padding:5px 9px;cursor:pointer}button[aria-pressed=true]{border-color:var(--primary);color:var(--primary)}a{color:var(--primary);text-decoration:none}a:hover{text-decoration:underline}:focus-visible{outline:2px solid var(--primary);outline-offset:3px}svg{width:100%;height:auto;display:block;min-height:180px}.gridline{stroke:var(--border);stroke-width:1}.axis{fill:var(--muted-foreground);font:12px ui-monospace,monospace}.up{stroke:var(--success);fill:var(--success)}.down{stroke:var(--destructive);fill:var(--destructive)}.volume{opacity:.55;stroke:none}.price-line{fill:none;stroke:var(--primary);stroke-width:2}.cursor{stroke:var(--muted-foreground);stroke-dasharray:4 4}.readout{min-height:40px;font-size:12px;overflow-wrap:anywhere;margin:8px 0}.table-scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:13px}caption{text-align:left;margin-bottom:8px;color:var(--muted-foreground)}th,td{text-align:right;padding:8px 6px;border-bottom:1px solid var(--border);white-space:nowrap}th:first-child,td:first-child{text-align:left}ul{margin:8px 0 0;padding-left:20px}li{margin:6px 0;overflow-wrap:anywhere}.compact{font-size:13px}.note{margin-top:12px;font-size:13px;color:var(--muted-foreground);overflow-wrap:anywhere}details{margin-top:12px}summary{cursor:pointer;color:var(--primary);font-size:13px}.spacing{margin-top:8px}@media(min-width:768px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.metrics.three{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:400px){body{padding:12px}.panel{padding:12px}.price{font-size:24px}.value{font-size:17px}}
.chart-summary{font-size:14px;line-height:1.6;overflow-wrap:anywhere;margin:8px 0}.readout{font-size:14px}
</style>
</head>
<body>
<main>
<header>
  <div><div class="title-row"><h1 id="ticker">종목 대시보드</h1><span id="decision" class="badge">대기</span></div><p id="status" class="muted" role="status">MCP Apps 연결 중…</p><p id="report-time" class="muted"></p></div>
  <div><p id="latest-price" class="price mono">—</p><p id="price-date" class="muted">완료 거래일 자료 대기</p><p id="dashboard-link" class="muted"></p></div>
</header>
<div id="dashboard" hidden>
<section class="panel" aria-labelledby="chart-heading">
  <div class="chart-header"><h2 id="chart-heading">가격 · 거래량</h2><div id="chart-controls" class="controls"><div class="control-group" role="group" aria-label="차트 기간"><button type="button" data-months="1" aria-pressed="false">1M</button><button type="button" data-months="3" aria-pressed="true">3M</button><button type="button" data-months="6" aria-pressed="false">6M</button><button type="button" data-months="12" aria-pressed="false">1Y</button></div><div class="control-group" role="group" aria-label="차트 유형"><button type="button" data-chart-type="candles" aria-pressed="true">캔들</button><button type="button" data-chart-type="line" aria-pressed="false">종가선</button></div></div></div>
  <p id="chart-empty" class="muted"></p><svg id="price-chart" viewBox="0 0 900 366" role="img" tabindex="0" aria-label="일봉 가격 및 거래량 차트" aria-describedby="chart-summary chart-help chart-readout"></svg><p id="chart-summary" class="chart-summary mono"></p><p id="chart-readout" class="readout mono" aria-live="polite"></p><p id="chart-help" class="muted">포인터를 움직이거나 차트에서 좌우 방향키·Home·End 키로 OHLC와 거래량을 확인하세요.</p><p id="chart-source" class="muted"></p>
</section>
<div class="grid">
<section class="panel" aria-labelledby="execution-heading"><h2 id="execution-heading">신호 · 진입 조건</h2><p id="entry-status"></p><p id="entry-price" class="muted"></p><dl class="metrics three spacing"><div class="metric"><dt>ATR</dt><dd id="atr" class="value"></dd></div><div class="metric"><dt>손절 참고선</dt><dd id="stop" class="value"></dd></div><div class="metric"><dt>목표 참고선</dt><dd id="target" class="value"></dd></div></dl><p class="note">참고선은 최근 완료 종가 기준입니다. 실제 다음 거래일 체결가에서 다시 계산해야 합니다.</p><p class="note">매수 점수 <span id="buy-score" class="mono"></span> · 매도 점수 <span id="sell-score" class="mono"></span> — 점수는 수익 확률이 아닙니다.</p><details><summary>판단 근거 보기</summary><ul id="gate-reasons" class="compact"></ul></details></section>
<section class="panel" aria-labelledby="history-heading"><h2 id="history-heading">과거 BUY 관측 결과</h2><dl class="metrics three"><div class="metric"><dt>5거래일 순수익 승률</dt><dd id="win-rate" class="value"></dd><dd id="win-count" class="muted"></dd></div><div class="metric"><dt>손절선 도달 비율</dt><dd id="stop-rate" class="value"></dd><dd id="stop-count" class="muted"></dd></div><div class="metric"><dt>목표선 도달 비율</dt><dd id="target-rate" class="value"></dd><dd id="target-count" class="muted"></dd></div></dl><p id="history-period" class="note mono"></p><p id="history-method" class="note"></p><p id="barrier-detail" class="note"></p><p class="note">과거 관측 비율이며 미래 승률을 보장하지 않습니다. 손절·목표 도달 비율은 5거래일 전체 경로의 별도 통계입니다.</p></section>
</div>
<section class="panel" aria-labelledby="valuation-heading"><h2 id="valuation-heading">PER · PSR 업종 비교</h2><p id="industry-name" class="muted"></p><div class="table-scroll"><table><caption>동일 업종 동종기업 표본의 양수 TTM 배수 중앙값</caption><thead><tr><th scope="col">지표</th><th scope="col">종목</th><th scope="col">표본 중앙값</th><th scope="col">유효 표본</th><th scope="col">상대 프리미엄</th></tr></thead><tbody><tr><th scope="row">TTM PER</th><td id="stock-pe"></td><td id="peer-pe"></td><td id="pe-samples"></td><td id="pe-premium"></td></tr><tr><th scope="row">TTM PSR</th><td id="stock-psr"></td><td id="peer-psr"></td><td id="psr-samples"></td><td id="psr-premium"></td></tr></tbody></table></div><p class="note">예상 PER <span id="forward-pe" class="mono"></span> — TTM 비교와 별도로 표시합니다. 표본 중앙값은 업계 전체 평균이 아닙니다.</p><p id="valuation-reasons" class="note"></p><p id="valuation-time" class="note"></p><p id="valuation-source" class="note"></p><details><summary>비교 종목 · 산출 기준</summary><p id="valuation-method" class="note"></p><p id="valuation-universe" class="note"></p><p id="peer-coverage" class="note"></p><div class="table-scroll"><table><thead><tr><th scope="col">동종기업</th><th scope="col">TTM PER</th><th scope="col">TTM PSR</th></tr></thead><tbody id="peer-rows"></tbody></table></div></details></section>
<section class="panel" aria-labelledby="analyst-heading"><h2 id="analyst-heading">애널리스트 목표가</h2><dl class="metrics three"><div class="metric"><dt>평균 목표가</dt><dd id="target-mean" class="value"></dd></div><div class="metric"><dt>중앙값</dt><dd id="target-median" class="value"></dd></div><div class="metric"><dt>평균까지 상승 여력</dt><dd id="target-upside" class="value"></dd></div><div class="metric"><dt>목표가 범위</dt><dd id="target-range" class="mono"></dd></div><div class="metric"><dt>참여 애널리스트</dt><dd id="analyst-count" class="mono"></dd></div></dl><p id="target-current" class="note"></p><p class="note">목표가 상승 여력은 수익 확률이 아닙니다. 컨센서스의 발표일·예측 기간은 제공되지 않습니다.</p><p id="target-time" class="note"></p><p id="target-source" class="note"></p><h3 class="spacing">최근 목표가 변경 · 최대 5건</h3><p id="recent-summary" class="muted"></p><ul id="analyst-updates" class="compact"></ul><p id="recent-reason" class="note"></p></section>
<details class="panel"><summary>자료 한계 · 확인 사항</summary><ul id="warnings" class="compact"></ul></details>
</div>
</main>
<script>${dashboardUiScript}</script>
</body>
</html>`;
