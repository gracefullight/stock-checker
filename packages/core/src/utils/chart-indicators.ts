export function calcSMA(closes: number[], period: number): (number | null)[] {
  return closes.map((_, i) => {
    if (i < period - 1) return null;
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j];
    return sum / period;
  });
}

export function calcBB(
  closes: number[],
  period = 20,
  mult = 2
): { upper: number | null; lower: number | null }[] {
  const sma = calcSMA(closes, period);
  return closes.map((_, i) => {
    if (sma[i] === null) return { upper: null, lower: null };
    const mean = sma[i] as number;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += (closes[j] - mean) ** 2;
    const sd = Math.sqrt(variance / period);
    return { upper: mean + mult * sd, lower: mean - mult * sd };
  });
}
