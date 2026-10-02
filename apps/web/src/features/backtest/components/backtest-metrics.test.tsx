import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BacktestMetrics } from '@/features/backtest/components/backtest-metrics';
import type { RunResultDTO } from '@/features/backtest/types/protocol';

function resultWithObservations(totalSignals: number): RunResultDTO {
  return {
    winRate: {
      totalSignals,
      wins: totalSignals,
      winRate5d: totalSignals > 0 ? 100 : 0,
      avgReturn: 1,
      avgWin: 1,
      avgLoss: 0,
      rewardRisk: 0,
      signalsPerMonth: 1,
    },
    equity: { points: [], totalReturn: 1, maxDrawdown: 1 },
    trades: totalSignals
      ? [
          {
            entryDate: '2026-09-01',
            exitDate: '2026-09-07',
            entryPrice: 100,
            exitPrice: 101,
            returnPct: 1,
          },
        ]
      : [],
    signals: [],
  };
}

function metric(label: string) {
  const container = screen.getByText(label).parentElement;
  if (!container) throw new Error(`Missing metric: ${label}`);
  return within(container);
}

describe('financial backtest metric presentation', () => {
  it('does not present zero observations as a zero percent win rate', () => {
    render(<BacktestMetrics result={resultWithObservations(0)} />);

    expect(metric('WIN RATE (5D)').getByText('N/A')).toBeInTheDocument();
    expect(metric('AVG RETURN').getByText('N/A')).toBeInTheDocument();
  });

  it('distinguishes overlapping buy observations from actually executed trades', () => {
    render(<BacktestMetrics result={resultWithObservations(3)} />);

    expect(metric('BUY OBSERVATIONS').getByText('3')).toBeInTheDocument();
    expect(metric('EXECUTED TRADES').getByText('1')).toBeInTheDocument();
  });

  it('does not display a zero payoff ratio when there are no losses to measure', () => {
    render(<BacktestMetrics result={resultWithObservations(3)} />);

    expect(metric('PAYOFF RATIO').getByText('N/A')).toBeInTheDocument();
  });
});
