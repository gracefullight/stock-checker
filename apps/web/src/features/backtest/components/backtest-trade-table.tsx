import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { TradeDTO } from '@/features/backtest/types/protocol';

interface BacktestTradeTableProps {
  trades: TradeDTO[];
}

export function BacktestTradeTable({ trades }: BacktestTradeTableProps) {
  if (trades.length === 0) {
    return <div className="font-mono text-xs text-muted-foreground">NO TRADES</div>;
  }

  return (
    <div className="max-h-[320px] overflow-y-auto">
      <Table aria-label="Backtest trades">
        <TableHeader>
          <TableRow>
            {['ENTRY', 'EXIT', 'ENTRY $', 'EXIT $', 'RETURN'].map((h) => (
              <TableHead
                key={h}
                className="text-muted-foreground font-normal font-mono text-xs whitespace-nowrap"
              >
                {h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {trades.map((t) => (
            <TableRow key={`${t.entryDate}-${t.exitDate}`}>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {t.entryDate}
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {t.exitDate}
              </TableCell>
              <TableCell className="font-mono text-xs tabular-nums text-right">
                {t.entryPrice.toFixed(2)}
              </TableCell>
              <TableCell className="font-mono text-xs tabular-nums text-right">
                {t.exitPrice.toFixed(2)}
              </TableCell>
              <TableCell
                className={`font-mono text-xs tabular-nums text-right ${
                  t.returnPct >= 0 ? 'text-success' : 'text-destructive'
                }`}
              >
                {t.returnPct >= 0 ? '+' : ''}
                {t.returnPct.toFixed(2)}%
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
