interface PatternListProps {
  patterns: string[];
}

const BEARISH_PREFIXES = ['Bearish', 'Descending', 'InvertedCup', 'ThreeDescending', 'Tops'];

const BEARISH_PATTERNS = /^(Bearish|Descending|InvertedCup|ThreeDescending|Measured.*Down|Tops)/;

function isBullish(pattern: string): boolean {
  return !BEARISH_PATTERNS.test(pattern);
}

export function PatternList({ patterns }: PatternListProps) {
  if (patterns.length === 0) {
    return <span className="text-xs text-[var(--text-secondary)] font-mono">—</span>;
  }

  return (
    <div className="flex flex-wrap gap-1" role="list" aria-label="Chart patterns">
      {patterns.map((pattern) => {
        const bullish = isBullish(pattern);
        const chipStyle = bullish
          ? 'border border-[var(--green)] text-[var(--green)]'
          : 'border border-[var(--red)] text-[var(--red)]';
        return (
          <span
            key={pattern}
            className={`inline-block rounded-sm px-1.5 py-0.5 text-[10px] font-mono leading-tight ${chipStyle}`}
            role="listitem"
            title={bullish ? 'Bullish pattern' : 'Bearish pattern'}
          >
            {pattern}
          </span>
        );
      })}
    </div>
  );
}

// Suppress unused variable warning for the array constant
void BEARISH_PREFIXES;
