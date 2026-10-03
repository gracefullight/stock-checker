export interface CalibrationParams {
  slope: number;
  intercept: number;
}

export interface CalibrationResult extends CalibrationParams {
  /** Brier score on the same observations used to select the parameters (in-sample). */
  brierScore: number;
}

function sigmoid(x: number, slope: number, intercept: number): number {
  return 1.0 / (1.0 + Math.exp(-(slope * x + intercept)));
}

/**
 * Selects sigmoid parameters from a fixed grid by the lowest in-sample Brier score.
 * The returned score reuses all fitting observations; it is not held-out validation.
 *
 * @param _cvFolds Reserved for backward compatibility and ignored; no cross-validation runs.
 */
export function fitPlattScaling(
  scores: number[],
  outcomes: boolean[],
  _cvFolds = 5
): CalibrationResult {
  const scoresArr = scores;
  const outcomesArr = outcomes.map((o) => (o ? 1 : 0));

  // Fixed grid shared with the learning evaluator.
  const slopes = [0.005, 0.01, 0.015, 0.02];
  const intercepts = [-2.0, -1.5, -1.0, -0.5, 0.0];

  let bestBrier = Infinity;
  let bestParams: CalibrationParams = { slope: 0.01, intercept: -1.0 };

  // Fit and evaluate every grid candidate on the same complete input dataset.

  for (const slope of slopes) {
    for (const intercept of intercepts) {
      let brierSum = 0;

      for (let i = 0; i < scoresArr.length; i++) {
        const p = sigmoid(scoresArr[i], slope, intercept);
        brierSum += (p - outcomesArr[i]) ** 2;
      }

      const brier = brierSum / scoresArr.length;

      if (brier < bestBrier) {
        bestBrier = brier;
        bestParams = { slope, intercept };
      }
    }
  }

  return {
    ...bestParams,
    brierScore: bestBrier,
  };
}
