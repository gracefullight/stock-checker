/**
 * Gaussian Channel (DonovanWall style)
 *
 * Defaults chosen to match the widely used TradingView reference:
 *   period = 144  — long enough to smooth intraday noise on daily bars
 *   poles  = 4    — four-pole filter gives excellent lag/smoothness balance
 *   mult   = 1.4  — band multiplier that keeps most price action inside channel
 *
 * Filter formula (N-pole recursive):
 *   beta  = (1 - cos(2π/period)) / (sqrt(2)^(2/poles) - 1)
 *   alpha = -beta + sqrt(beta² + 2·beta)
 *
 * Each pole applies:  f[i] = alpha·src[i] + (1-alpha)·f[i-1]
 * Four poles are cascaded so the output is a heavily smoothed estimate of price.
 *
 * Direction is determined by comparing the last filter value to the previous one.
 * "Green" channel = filter rising (uptrend).  "Red" = falling (downtrend).
 */

export interface GaussianChannelPoint {
  mid: number;
  upper: number;
  lower: number;
  direction: 'up' | 'down' | 'flat';
  isGreen: boolean;
}

export interface GaussianChannelOptions {
  /** Smoothing period.  Default: 144 */
  period?: number;
  /** Number of recursive poles.  Default: 4 */
  poles?: number;
  /** Band multiplier applied to the filtered true-range.  Default: 1.4 */
  mult?: number;
}

/**
 * Compute the Gaussian filter series over `values`.
 * Returns the full array of filtered values (same length as input).
 */
function gaussianFilter(values: number[], alpha: number, poles: number): number[] {
  const n = values.length;
  const result = new Float64Array(n);

  // Initialise first sample to avoid cold-start bias
  result[0] = values[0];

  for (let i = 1; i < n; i++) {
    const v = values[i];
    // Cascade `poles` times on the same bar using previous bar's pole outputs
    // We store intermediate pole values per bar to keep it stateless per-pass.
    // For pole k: f_k[i] = alpha * f_{k-1}[i] + (1-alpha) * f_k[i-1]
    // We approximate by running all poles in a single forward pass per bar:
    let filtered = v;
    for (let p = 0; p < poles; p++) {
      filtered = alpha * filtered + (1 - alpha) * result[i - 1];
    }
    result[i] = filtered;
  }

  // --- true multi-pole pass: re-run with proper per-pole state ---
  // The above single-pass is a simplification; the proper version maintains
  // separate state arrays for each pole.
  const poles_state: Float64Array[] = Array.from({ length: poles }, () => new Float64Array(n));
  for (let p = 0; p < poles; p++) {
    poles_state[p][0] = values[0];
  }
  for (let i = 1; i < n; i++) {
    // pole 0 receives raw price
    poles_state[0][i] = alpha * values[i] + (1 - alpha) * poles_state[0][i - 1];
    // subsequent poles receive the previous pole's output
    for (let p = 1; p < poles; p++) {
      poles_state[p][i] = alpha * poles_state[p - 1][i] + (1 - alpha) * poles_state[p][i - 1];
    }
  }
  // Final filtered series is the last pole
  return Array.from(poles_state[poles - 1]);
}

/**
 * Compute the Gaussian Channel for a price series.
 *
 * @param values  Array of price values (close prices, length ≥ 2).
 * @param opts    Optional overrides for period, poles, mult.
 * @returns       Latest-bar channel result plus the full series for backtesting.
 */
export function gaussianChannel(
  values: number[],
  opts: GaussianChannelOptions = {}
): GaussianChannelPoint & { series: GaussianChannelPoint[] } {
  const period = opts.period ?? 144;
  const poles = opts.poles ?? 4;
  const mult = opts.mult ?? 1.4;

  if (values.length < 2) {
    const mid = values[0] ?? 0;
    const point: GaussianChannelPoint = {
      mid,
      upper: mid,
      lower: mid,
      direction: 'flat',
      isGreen: false,
    };
    return { ...point, series: [point] };
  }

  // Derive alpha from the DonovanWall formula
  const sqrtTwo = Math.SQRT2; // 2^0.5
  const pow = sqrtTwo ** (2 / poles) - 1; // sqrt(2)^(2/poles) - 1
  const cosVal = Math.cos((2 * Math.PI) / period);
  const beta = (1 - cosVal) / pow;
  const alpha = -beta + Math.sqrt(beta * beta + 2 * beta);

  // Filtered mid-price
  const filtered = gaussianFilter(values, alpha, poles);

  // True range for each bar (approximation using just high/low absent; use |diff| as proxy)
  // Since we only have close prices, approximate TR as |close[i] - close[i-1]|
  const trueRanges: number[] = [0];
  for (let i = 1; i < values.length; i++) {
    trueRanges.push(Math.abs(values[i] - values[i - 1]));
  }
  const filteredTR = gaussianFilter(trueRanges, alpha, poles);

  // Build series
  const series: GaussianChannelPoint[] = [];
  for (let i = 0; i < values.length; i++) {
    const mid = filtered[i];
    const bandWidth = filteredTR[i] * mult;
    const upper = mid + bandWidth;
    const lower = mid - bandWidth;

    let direction: 'up' | 'down' | 'flat';
    if (i === 0) {
      direction = 'flat';
    } else {
      const delta = filtered[i] - filtered[i - 1];
      // Use a small epsilon relative to price to avoid floating-point noise
      const epsilon = mid * 1e-8;
      if (delta > epsilon) {
        direction = 'up';
      } else if (delta < -epsilon) {
        direction = 'down';
      } else {
        direction = 'flat';
      }
    }

    series.push({ mid, upper, lower, direction, isGreen: direction === 'up' });
  }

  const latest = series[series.length - 1];
  return { ...latest, series };
}
