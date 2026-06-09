'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { FearGreedResult } from '@/lib/api';
import { getFearGreed } from '@/lib/api';

function getBadgeVariant(value: number): 'default' | 'destructive' | 'outline' {
  if (value >= 60) return 'default'; // success — we'll override color via className
  if (value <= 30) return 'destructive';
  return 'outline';
}

function getValueColorClass(value: number): string {
  if (value >= 60) return 'text-success';
  if (value <= 30) return 'text-destructive';
  return 'text-warning';
}

export function FearGreedDisplay() {
  const [data, setData] = useState<FearGreedResult | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    getFearGreed()
      .then(setData)
      .catch(() => setError(true));
  }, []);

  if (error) {
    return <span className="text-xs font-mono text-muted-foreground">F&G: N/A</span>;
  }

  if (!data) {
    return <span className="text-xs font-mono text-muted-foreground">F&G: ...</span>;
  }

  const colorClass = getValueColorClass(data.value);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={(props) => (
            <span
              {...props}
              role="img"
              className="text-xs font-mono cursor-default"
              aria-label={`Fear & Greed Index: ${data.value} (${data.label})`}
            >
              <span className="text-muted-foreground">F&G: </span>
              <Badge
                variant={getBadgeVariant(data.value)}
                className={`font-mono font-bold ${colorClass}`}
              >
                {data.value}
              </Badge>
            </span>
          )}
        />
        <TooltipContent>
          <span className="font-mono text-xs">{data.label}</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
