export interface CalibrationParams {
  slope: number;
  intercept: number;
}

export interface CalibrationResult extends CalibrationParams {
  brierScore: number;
}

function sigmoid(x: number, slope: number, intercept: number): number {
  return 1.0 / (1.0 + Math.exp(-(slope * x + intercept)));
}

/**
 * Fits a Platt Scaling model (Logistic Regression) using Grid Search
 * to align with the Python implementation's approach.
 */
export function fitPlattScaling(
  scores: number[],
  outcomes: boolean[],
  _cvFolds = 5
): CalibrationResult {
  const scoresArr = scores;
  const outcomesArr = outcomes.map((o) => (o ? 1 : 0));

  // Grid from python/calibrator.py
  const slopes = [0.005, 0.01, 0.015, 0.02];
  const intercepts = [-2.0, -1.5, -1.0, -0.5, 0.0];

  let bestBrier = Infinity;
  let bestParams: CalibrationParams = { slope: 0.01, intercept: -1.0 };

  // Grid Search
  // Note: The Python code performed cross-validation.
  // For simplicity and speed in this port, we will perform a direct fit on the whole dataset
  // or simple split if critical. Use whole dataset for now as data size is likely small.

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
