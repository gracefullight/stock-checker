import { cva } from 'class-variance-authority';

import { Badge } from '@/components/ui/badge';
import type { SignalVisualState } from '@/lib/signal-visuals';
import { cn } from '@/lib/utils';

const signalBadgeVariants = cva('font-mono tracking-widest rounded-sm text-xs font-bold', {
  variants: {
    state: {
      buy: 'bg-success text-success-foreground border-transparent',
      sell: 'bg-destructive/10 text-destructive border-transparent',
      hold: 'bg-muted text-muted-foreground border-transparent',
      blocked: 'bg-warning/15 text-warning border border-warning/60',
    },
  },
  defaultVariants: {
    state: 'hold',
  },
});

interface SignalBadgeProps {
  signal: 'BUY' | 'SELL' | 'HOLD';
  /**
   * True for a HOLD whose buy score cleared the threshold but a gate blocked
   * the entry. Rendered as "HOLD · BLOCKED" so the state is never colour-only.
   */
  blocked?: boolean;
}

export function SignalBadge({ signal, blocked = false }: SignalBadgeProps) {
  const state: SignalVisualState =
    signal === 'BUY' ? 'buy' : signal === 'SELL' ? 'sell' : blocked ? 'blocked' : 'hold';
  const label = state === 'blocked' ? 'HOLD · BLOCKED' : signal;
  return (
    <Badge
      className={cn(signalBadgeVariants({ state }))}
      aria-label={state === 'blocked' ? 'Signal: HOLD (blocked setup)' : `Signal: ${signal}`}
      title={
        state === 'blocked'
          ? '점수는 기준 이상이지만 게이트가 진입을 차단한 HOLD'
          : state === 'sell'
            ? '보유자 청산 경고 (공매도 추천 아님)'
            : undefined
      }
    >
      {label}
    </Badge>
  );
}
