import { cva } from 'class-variance-authority';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface PatternListProps {
  patterns: string[];
}

const BEARISH_PREFIXES = ['Bearish', 'Descending', 'InvertedCup', 'ThreeDescending', 'Tops'];

const BEARISH_PATTERNS = /^(Bearish|Descending|InvertedCup|ThreeDescending|Measured.*Down|Tops)/;

function isBullish(pattern: string): boolean {
  return !BEARISH_PATTERNS.test(pattern);
}

const patternChipVariants = cva('font-mono text-[10px] leading-tight rounded-sm px-1.5 py-0.5', {
  variants: {
    sentiment: {
      bullish: 'border-success text-success',
      bearish: 'border-destructive text-destructive',
    },
  },
  defaultVariants: {
    sentiment: 'bullish',
  },
});

export function PatternList({ patterns }: PatternListProps) {
  if (patterns.length === 0) {
    return <span className="text-xs text-muted-foreground font-mono">—</span>;
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: role="list" on a flex container is intentional; native <ul> would impose list-item layout/margins that break the chip wrap.
    <div className="flex flex-wrap gap-1" role="list" aria-label="Chart patterns">
      {patterns.map((pattern) => {
        const bullish = isBullish(pattern);
        return (
          <Badge
            key={pattern}
            variant="outline"
            className={cn(patternChipVariants({ sentiment: bullish ? 'bullish' : 'bearish' }))}
            role="listitem"
            title={bullish ? 'Bullish pattern' : 'Bearish pattern'}
          >
            {pattern}
          </Badge>
        );
      })}
    </div>
  );
}

// Suppress unused variable warning for the array constant
void BEARISH_PREFIXES;
