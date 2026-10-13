/**
 * Small, dependency-free statistics shared by the frozen validation report and
 * the forward paper ledger. Every interval here treats samples as independent.
 */

/** Deterministic 32-bit generator (mulberry32) so bootstrap intervals are reproducible. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

/** Linear-interpolated percentile on a sorted copy; null for an empty sample. */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.min(sorted.length - 1, lower + 1);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export interface PercentInterval {
  lowerPct: number;
  upperPct: number;
}

/** Wilson score interval for a binomial proportion, in percent. */
export function wilsonInterval(wins: number, samples: number, z = 1.96): PercentInterval | null {
  if (!Number.isInteger(samples) || samples <= 0 || wins < 0 || wins > samples) return null;
  const p = wins / samples;
  const denominator = 1 + (z * z) / samples;
  const centre = (p + (z * z) / (2 * samples)) / denominator;
  const half =
    (z * Math.sqrt((p * (1 - p)) / samples + (z * z) / (4 * samples * samples))) / denominator;
  return { lowerPct: (centre - half) * 100, upperPct: (centre + half) * 100 };
}

export interface BootstrapMeanInterval extends PercentInterval {
  meanPct: number;
  resamples: number;
  seed: number;
}

/** Seeded percentile bootstrap of the mean; values are resampled as independent draws. */
export function bootstrapMeanInterval(
  values: number[],
  options: { resamples?: number; seed?: number } = {}
): BootstrapMeanInterval | null {
  const resamples = options.resamples ?? 2000;
  const seed = options.seed ?? 20261006;
  if (!values.length || !Number.isInteger(resamples) || resamples < 100) return null;
  const random = seededRandom(seed);
  const means: number[] = [];
  for (let draw = 0; draw < resamples; draw++) {
    let sum = 0;
    for (let index = 0; index < values.length; index++)
      sum += values[Math.floor(random() * values.length)];
    means.push(sum / values.length);
  }
  means.sort((left, right) => left - right);
  return {
    meanPct: mean(values) as number,
    lowerPct: means[Math.floor(resamples * 0.025)],
    upperPct: means[Math.ceil(resamples * 0.975) - 1],
    resamples,
    seed,
  };
}
