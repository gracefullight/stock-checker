'use client';

import { X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { addToPortfolio, removeFromPortfolio } from '@/lib/api';

interface PortfolioControlsProps {
  tickers: string[];
}

export function PortfolioControls({ tickers }: PortfolioControlsProps) {
  const router = useRouter();
  const [symbol, setSymbol] = useState('');
  const [pending, setPending] = useState(false);

  async function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = symbol.trim().toUpperCase();
    if (!/^[A-Z][A-Z.]{0,5}$/.test(trimmed)) {
      toast.error('Invalid ticker symbol');
      return;
    }

    setPending(true);
    try {
      await addToPortfolio(trimmed);
      toast.success(`${trimmed} added to portfolio`);
      setSymbol('');
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to add ${trimmed}`);
    } finally {
      setPending(false);
    }
  }

  async function handleRemove(ticker: string) {
    setPending(true);
    try {
      await removeFromPortfolio(ticker);
      toast.success(`${ticker} removed from portfolio`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to remove ${ticker}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={handleAdd}
        className="flex items-center gap-2"
        aria-label="Add ticker to portfolio"
      >
        <label htmlFor="portfolio-ticker-input" className="sr-only">
          Ticker symbol
        </label>
        <Input
          id="portfolio-ticker-input"
          type="text"
          placeholder="TICKER"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          disabled={pending}
          className="w-32 font-mono text-xs uppercase"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
        />
        <Button
          type="submit"
          size="sm"
          disabled={pending || !symbol.trim()}
          className="font-mono text-xs"
        >
          ADD
        </Button>
      </form>

      {tickers.length > 0 && (
        // biome-ignore lint/a11y/useSemanticElements: role="list" on a flex container is intentional; native <ul> would impose list styling that breaks the inline chip layout.
        <div className="flex flex-wrap gap-2" role="list" aria-label="Portfolio holdings">
          {tickers.map((ticker) => (
            // biome-ignore lint/a11y/useSemanticElements: role="listitem" pairs with the parent role="list"; native <li> requires a <ul>/<ol> ancestor which is intentionally avoided here.
            <div
              key={ticker}
              role="listitem"
              className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2 py-1 font-mono text-xs text-foreground"
            >
              <span>{ticker}</span>
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={pending}
                onClick={() => handleRemove(ticker)}
                aria-label={`Remove ${ticker}`}
                className="text-muted-foreground hover:text-destructive"
              >
                <X />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
