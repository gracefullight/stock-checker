interface SignalBadgeProps {
  signal: 'BUY' | 'SELL' | 'HOLD';
}

const signalStyles: Record<string, string> = {
  BUY: 'bg-[var(--green)] text-[#0a0a0a]',
  SELL: 'bg-[var(--red)] text-[#0a0a0a]',
  HOLD: 'bg-[#444444] text-[var(--text-primary)]',
};

export function SignalBadge({ signal }: SignalBadgeProps) {
  const style = signalStyles[signal] ?? signalStyles.HOLD;
  return (
    <span
      className={`inline-block rounded-sm px-2 py-0.5 text-xs font-bold tracking-widest font-mono ${style}`}
      aria-label={`Signal: ${signal}`}
    >
      {signal}
    </span>
  );
}
