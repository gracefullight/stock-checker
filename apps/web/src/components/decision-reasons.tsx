import type { TickerResult } from '@/lib/api';
import { describeTickerDecision } from '@/lib/signal-reasons.locale';
import type { SignalThresholds } from '@/lib/signal-visuals';

interface DecisionReasonsProps {
  result: TickerResult;
  thresholds: SignalThresholds;
}

/** Korean decision reasons for the detail page, from one shared locale module. */
export function DecisionReasons({ result, thresholds }: DecisionReasonsProps) {
  const lines = describeTickerDecision(result, thresholds);
  return (
    <ol className="list-decimal space-y-1 pl-5 font-mono text-xs text-foreground" lang="ko">
      {lines.map((line, index) => (
        <li key={String(index) + line} className={index === 0 ? 'font-bold' : undefined}>
          {line}
        </li>
      ))}
    </ol>
  );
}
