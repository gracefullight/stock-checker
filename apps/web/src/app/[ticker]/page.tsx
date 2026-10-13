import Link from 'next/link';
import {
  EarningsWarningBadge,
  isEarningsInsideHold,
} from '@/components/common/earnings-warning-badge';
import { ValidatedStrategyNote } from '@/components/common/validated-strategy-note';
import { ConvertedPrice } from '@/components/converted-price';
import { DecisionReasons } from '@/components/decision-reasons';
import { EarningsPanel } from '@/components/earnings-panel';
import { FundamentalsCard } from '@/components/fundamentals-card';
import { IndicatorRow } from '@/components/indicator-row';
import { NewsPanel } from '@/components/news-panel';
import { PatternList } from '@/components/pattern-list';
import { ScoreBar } from '@/components/score-bar';
import { SignalBadge } from '@/components/signal-badge';
import { TickerCharts } from '@/components/ticker-charts';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { UpcomingEventsCard } from '@/components/upcoming-events-card';
import { getTickerDetail } from '@/lib/api';
import { INDICATOR_ZONES } from '@/lib/indicator-zones';
import { deriveSignalVisual, signalThresholdsFromConfig } from '@/lib/signal-visuals';
import { VALIDATED_STRATEGY } from '@/lib/validated-strategy.constants';

interface PageProps {
  params: Promise<{ ticker: string }>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const headingId = `section-${title.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <Card
      className="rounded-none ring-0 border border-border bg-card py-0"
      aria-labelledby={headingId}
      role="region"
    >
      <CardHeader className="px-3 py-1.5 border-b border-border rounded-none bg-muted/30">
        <CardTitle>
          <h2
            id={headingId}
            className="text-[10px] font-mono font-bold tracking-widest text-primary"
          >
            {title}
          </h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3">{children}</CardContent>
    </Card>
  );
}

function formatPrice(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

export default async function TickerDetailPage({ params }: PageProps) {
  const { ticker } = await params;
  const symbol = ticker.toUpperCase();

  let data: Awaited<ReturnType<typeof getTickerDetail>> | undefined;
  let error: string | null = null;

  try {
    data = await getTickerDetail(symbol, ['fundamentals', 'earnings', 'news', 'dividends']);
  } catch (err) {
    error = err instanceof Error ? err.message : 'Failed to fetch ticker data';
  }

  if (error) {
    return (
      <div>
        <div className="mb-4">
          <Link href="/" className="text-xs font-mono text-muted-foreground hover:text-primary">
            &lt; BACK TO SCREENER
          </Link>
        </div>
        <div
          className="p-4 border border-destructive bg-card font-mono text-xs text-destructive"
          role="alert"
        >
          ERROR [{symbol}]: {error}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="font-mono text-xs text-muted-foreground" aria-live="polite">
        LOADING...
      </div>
    );
  }

  const signal = data.opinion as 'BUY' | 'SELL' | 'HOLD';
  const thresholds = signalThresholdsFromConfig(data.pipelineConfig);
  const visual = deriveSignalVisual({
    decision: data.opinion,
    score: data.score,
    buyScore: data.buyScore,
    thresholds,
  });
  const currency = (data.currency ?? 'USD').toUpperCase();
  const isUsd = currency === 'USD';

  const nextEarningsDate = data.nextEarningsDate ?? data.fundamentals?.nextEarningsDate ?? null;
  const exDividendDate = data.fundamentals?.exDividendDate ?? null;
  const earningsInsideHold = isEarningsInsideHold(data.daysToEarnings);
  const chartEvents: Array<{ date: string; kind: 'earnings' | 'exDividend' }> = [
    ...(nextEarningsDate
      ? [{ date: nextEarningsDate.slice(0, 10), kind: 'earnings' as const }]
      : []),
    ...(exDividendDate ? [{ date: exDividendDate.slice(0, 10), kind: 'exDividend' as const }] : []),
  ];

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <div>
        <Link href="/" className="text-xs font-mono text-muted-foreground hover:text-primary">
          &lt; BACK TO SCREENER
        </Link>
      </div>

      {/* Header */}
      <div className="border border-border bg-card p-4">
        <div className="flex items-center gap-4 flex-wrap">
          <h1 className="text-3xl font-bold font-mono text-foreground tracking-widest">{symbol}</h1>
          <SignalBadge signal={signal} blocked={visual.state === 'blocked'} />
          {signal === 'BUY' && (
            <EarningsWarningBadge
              daysToEarnings={data.daysToEarnings}
              nextEarningsDate={nextEarningsDate}
            />
          )}
          <span className="text-2xl font-mono font-bold tabular-nums text-warning">
            {isUsd ? `$${data.close.toFixed(2)}` : formatPrice(data.close, currency)}
          </span>
          {isUsd && <ConvertedPrice usd={data.close} />}
          <span className="text-xs font-mono text-muted-foreground ml-auto">세션 {data.date}</span>
          <Link
            href={`/${symbol}/backtest`}
            className="text-xs font-mono text-primary hover:underline"
          >
            [BACKTEST]
          </Link>
        </div>
        {data.name && (
          <div className="mt-1 font-mono text-sm text-muted-foreground">{data.name}</div>
        )}
        {data.trendRegime && (
          <div className="mt-2 text-xs font-mono text-muted-foreground">
            REGIME: <span className="text-foreground">{data.trendRegime.toUpperCase()}</span>
            {data.exchange && (
              <>
                {' '}
                · EXCHANGE: <span className="text-foreground">{data.exchange}</span>
              </>
            )}
          </div>
        )}
      </div>

      {!isUsd && (
        <Alert>
          <AlertTitle className="font-mono text-xs font-bold">미국 외 상장 종목</AlertTitle>
          <AlertDescription className="font-mono text-xs">
            가격은 {currency} 기준입니다. 이 전략은 미국 상장 유니버스에서만 검증되었고 SPY·섹터 ETF
            상대강도를 사용하므로 BUY/HOLD 판단은 검증 범위 밖입니다.
          </AlertDescription>
        </Alert>
      )}

      {earningsInsideHold && nextEarningsDate && (
        <Alert>
          <AlertTitle className="font-mono text-xs font-bold text-warning">
            실적 발표가 보유 구간 안에 있음
          </AlertTitle>
          <AlertDescription className="font-mono text-xs">
            다음 실적 발표 {nextEarningsDate.slice(0, 10)} (거래일 D-{data.daysToEarnings})는 다음
            세션 시가 진입 → {VALIDATED_STRATEGY.holdSessions}번째 세션 종가 청산 구간에 포함됩니다.
            검증 결과는 실적 이벤트 리스크를 별도로 가격에 반영하지 않았습니다.
          </AlertDescription>
        </Alert>
      )}

      {/* Price chart + signal charts */}
      <Section title="PRICE CHART">
        <TickerCharts
          ticker={symbol}
          decision={signal}
          buyWeight={data.buyProbability}
          sellWeight={data.sellProbability}
          holdWeight={data.holdProbability}
          rsi={data.rsi}
          stochasticK={data.stochasticK}
          events={chartEvents}
          currentConfig={
            data.strategyId || data.configSha256
              ? { strategyId: data.strategyId, configSha256: data.configSha256 }
              : undefined
          }
        />
      </Section>

      {/* Decision reasons (Korean, shared locale) */}
      <Section title="DECISION REASONS · 결정 사유">
        <DecisionReasons result={data} thresholds={thresholds} />
      </Section>

      {/* Fundamentals + events / earnings + news */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-4">
          {data.fundamentals && (
            <Section title="FUNDAMENTALS">
              <FundamentalsCard fundamentals={data.fundamentals} />
            </Section>
          )}
          <Section title="UPCOMING EVENTS">
            <UpcomingEventsCard
              nextEarningsDate={nextEarningsDate ? nextEarningsDate.slice(0, 10) : null}
              daysToEarnings={data.daysToEarnings ?? null}
              exDividendDate={exDividendDate}
              dividendDate={data.fundamentals?.dividendDate ?? null}
            />
          </Section>
        </div>
        <div className="space-y-4">
          {data.earnings && (
            <Section title="EARNINGS">
              <EarningsPanel earnings={data.earnings} />
            </Section>
          )}
          <Section title="NEWS">
            <NewsPanel news={data.news ?? []} />
          </Section>
        </div>
      </div>

      {/* 2-column grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Indicators */}
        <Section title="TECHNICAL INDICATORS">
          <p className="mb-2 font-mono text-[10px] text-muted-foreground">
            OB = 과매수, OS = 과매도 (amber 표시). 지표 극단은 참고 정보이며 BUY/SELL 색과
            무관합니다.
          </p>
          <table className="w-full" aria-label="Technical indicators">
            <tbody>
              <IndicatorRow label="RSI (14)" value={data.rsi} zone={INDICATOR_ZONES.rsi} />
              <IndicatorRow
                label="Stochastic K"
                value={data.stochasticK}
                zone={INDICATOR_ZONES.stochK}
              />
              <IndicatorRow
                label="Williams %R"
                value={data.williamsR}
                zone={INDICATOR_ZONES.williamsR}
              />
              <IndicatorRow
                label="MACD"
                value={data.macd}
                note={data.macd >= 0 ? 'ABOVE 0' : 'BELOW 0'}
              />
              <IndicatorRow label="MACD Signal" value={data.macdSignal} />
              <IndicatorRow
                label="MACD Histogram"
                value={data.macdHistogram}
                note={data.macdHistogram >= 0 ? 'POSITIVE' : 'NEGATIVE'}
              />
              <IndicatorRow label="BB Lower" value={data.bbLower} />
              <IndicatorRow label="BB Upper" value={data.bbUpper} />
              <IndicatorRow label="Donchian Lower" value={data.donchLower} />
              <IndicatorRow label="Donchian Upper" value={data.donchUpper} />
              <IndicatorRow label="SMA 20" value={data.sma20} />
              <IndicatorRow label="EMA 20" value={data.ema20} />
              {data.sma50 !== undefined && (
                <IndicatorRow
                  label="SMA 50"
                  value={data.sma50}
                  note={data.close < data.sma50 ? '종가 아래 (풀백)' : '종가 위'}
                />
              )}
              {data.sma200 !== undefined && <IndicatorRow label="SMA 200" value={data.sma200} />}
              {data.volumeRatio !== undefined && (
                <IndicatorRow
                  label="Volume Ratio"
                  value={data.volumeRatio}
                  note={
                    data.volumeRatio >= 1.5 ? 'HIGH' : data.volumeRatio <= 0.5 ? 'LOW' : undefined
                  }
                />
              )}
              <IndicatorRow label="평균 가격 변동폭 (ATR)" value={data.atr} />
            </tbody>
          </table>
        </Section>

        {/* Right column: Score + Risk */}
        <div className="space-y-4">
          <Section title="COMPOSITE SCORE">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-muted-foreground w-20">SCORE</span>
                <ScoreBar
                  value={data.score}
                  decision={data.opinion}
                  buyScore={data.buyScore}
                  thresholds={thresholds}
                />
              </div>
              <p className="text-xs font-mono text-muted-foreground" lang="ko">
                기준 (현재 설정{data.pipelineConfig ? ', 고정 스냅샷' : ', 기본값'}): BUY ≥{' '}
                <span className="text-foreground">{thresholds.buy}</span>
                {thresholds.scoreMax !== undefined && (
                  <>
                    {' '}
                    그리고 &lt; <span className="text-foreground">{thresholds.scoreMax}</span> (과열
                    상한)
                  </>
                )}{' '}
                · SELL ≥ <span className="text-foreground">{thresholds.sell}</span>. 점수가 기준을
                넘어도 추세·클러스터·진입 품질 게이트를 모두 통과해야 BUY입니다.
              </p>
              <ValidatedStrategyNote
                perSample={[{ label: '이 종목 최근 결정', value: visual.label }]}
              />
            </div>
          </Section>

          <Section title="LONG POSITION REFERENCE">
            <p className="mb-2 text-xs font-mono text-muted-foreground" lang="ko">
              검증된 실행 규칙: 진입 = 다음 세션 시가, 청산 = {VALIDATED_STRATEGY.holdSessions}번째
              세션 종가 (진입 세션 포함). 아래 손절·목표가는 검증되지 않은 참고 지표이며, SELL은
              보유 포지션 청산 경고입니다.
            </p>
            <table className="w-full" aria-label="Long position risk reference levels">
              <tbody>
                <IndicatorRow label="Stop Loss (미검증 참고)" value={data.stopLoss} />
                <IndicatorRow label="Take Profit (미검증 참고)" value={data.takeProfit} />
                <IndicatorRow label="Initial Trailing Stop" value={data.trailingStop} />
                <IndicatorRow label="Trailing Start" value={data.trailingStart} />
              </tbody>
            </table>
          </Section>
        </div>
      </div>

      {/* Patterns */}
      <Section title="CHART PATTERNS">
        <PatternList patterns={data.patterns} />
      </Section>
    </div>
  );
}
