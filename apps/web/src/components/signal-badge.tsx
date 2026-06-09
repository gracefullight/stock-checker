import { cva } from 'class-variance-authority';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const signalBadgeVariants = cva('font-mono tracking-widest rounded-sm text-xs font-bold', {
  variants: {
    signal: {
      BUY: 'bg-success text-success-foreground border-transparent',
      SELL: 'bg-destructive/10 text-destructive border-transparent',
      HOLD: 'bg-muted text-muted-foreground border-transparent',
    },
  },
  defaultVariants: {
    signal: 'HOLD',
  },
});

interface SignalBadgeProps {
  signal: 'BUY' | 'SELL' | 'HOLD';
}

export function SignalBadge({ signal }: SignalBadgeProps) {
  return (
    <Badge className={cn(signalBadgeVariants({ signal }))} aria-label={`Signal: ${signal}`}>
      {signal}
    </Badge>
  );
}
