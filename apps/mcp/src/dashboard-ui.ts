import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** MCP Apps stable protocol: https://github.com/modelcontextprotocol/ext-apps/tree/main/specification/2026-01-26 */
export const DASHBOARD_RESOURCE_URI = 'ui://stock-checker/dashboard';
export const DASHBOARD_MIME_TYPE = 'text/html;profile=mcp-app';
export const DASHBOARD_RESOURCE_META = {
  ui: {
    csp: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] },
    prefersBorder: true,
  },
};

// The client is plain JavaScript kept in its own module so Biome and tsc (checkJs)
// cover it; it is read at runtime and inlined, so the resource still needs no build
// step or network assets.
export const dashboardUiScript = readFileSync(
  fileURLToPath(new URL('./dashboard-client.js', import.meta.url)),
  'utf8'
);

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
<section class="panel" aria-labelledby="execution-heading"><h2 id="execution-heading">신호 · 진입 조건</h2><p id="entry-status"></p><p id="entry-price" class="muted"></p><dl class="metrics three spacing"><div class="metric"><dt>평균 가격 변동폭</dt><dd id="atr" class="value"></dd></div><div class="metric"><dt>손절 참고선</dt><dd id="stop" class="value"></dd></div><div class="metric"><dt>목표 참고선</dt><dd id="target" class="value"></dd></div></dl><p class="note">참고선은 최근 완료 종가 기준입니다. 실제 다음 거래일 체결가에서 다시 계산해야 합니다.</p><p class="note">매수 점수 <span id="buy-score" class="mono"></span> · 매도 점수 <span id="sell-score" class="mono"></span> — 점수는 수익 확률이 아닙니다.</p><details><summary>판단 근거 보기</summary><ul id="gate-reasons" class="compact"></ul></details></section>
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
