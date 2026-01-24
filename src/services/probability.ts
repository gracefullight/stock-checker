/**
 * Probability Calibration Service
 * Converts raw BUY/SELL scores to calibrated 0-100% probabilities
 * Uses sigmoid (Platt scaling) for score-to-probability mapping
 */

export interface ProbabilityResult {
  buyProbability: number; // 0-100% confidence for BUY
  sellProbability: number; // 0-100% confidence for SELL
  holdProbability: number; // 0-100% confidence for HOLD
  confidence: 'low' | 'medium' | 'high' | 'very-high';
}

/**
 * Sigmoid function for Platt scaling
 * Maps score [-∞, +∞] to probability [0, 1]
 * Uses calibrated slope and intercept parameters
 */
function sigmoid(score: number, slope: number = 0.01, intercept: number = -1.0): number {
  return 1 / (1 + Math.exp(-(slope * score + intercept)));
}

/**
 * Convert buy and sell scores to probabilities
 * @param buyScore - Raw BUY indicator score
 * @param sellScore - Raw SELL indicator score
 * @param calibration - Optional calibration parameters {slope, intercept}
 * @returns Probability result with confidence level
 */
export function calculateProbabilities(
  buyScore: number,
  sellScore: number,
  calibration: { slope?: number; intercept?: number } = {}
): ProbabilityResult {
  const slope = calibration.slope ?? 0.01;
  const intercept = calibration.intercept ?? -1.0;

  // Convert scores to probabilities using sigmoid
  const buyProb = sigmoid(buyScore, slope, intercept);
  const sellProb = sigmoid(sellScore, slope, intercept);

  // HOLD probability = 1 - (buyProb + sellProb) normalized
  const totalProb = buyProb + sellProb;
  const holdProb = Math.max(0, 1 - totalProb);

  // Normalize to ensure they sum to ~1
  const sum = buyProb + sellProb + holdProb;
  const buyProbability = (buyProb / sum) * 100;
  const sellProbability = (sellProb / sum) * 100;
  const holdProbability = (holdProb / sum) * 100;

  // Determine confidence level
  const maxProb = Math.max(buyProbability, sellProbability);
  let confidence: ProbabilityResult['confidence'];
  if (maxProb >= 75) {
    confidence = 'very-high';
  } else if (maxProb >= 60) {
    confidence = 'high';
  } else if (maxProb >= 40) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  return {
    buyProbability: parseFloat(buyProbability.toFixed(1)),
    sellProbability: parseFloat(sellProbability.toFixed(1)),
    holdProbability: parseFloat(holdProbability.toFixed(1)),
    confidence,
  };
}

/**
 * Estimate calibration parameters from historical data
 * This should be called by the Python optimizer
 * @param historicalScores - Array of historical scores
 * @param actualOutcomes - Array of actual outcomes (1 for correct, 0 for incorrect)
 * @returns Calibration parameters for sigmoid function
 */
export function fitCalibration(
  historicalScores: number[],
  actualOutcomes: number[]
): { slope: number; intercept: number } {
  if (historicalScores.length === 0) {
    return { slope: 0.01, intercept: -1.0 };
  }

  // Simple logistic regression to fit sigmoid parameters
  // Using iterative approach to find best fit
  let bestSlope = 0.01;
  let bestIntercept = -1.0;
  let bestBrier = Infinity;

  for (const slope of [0.005, 0.01, 0.015, 0.02]) {
    for (const intercept of [-2.0, -1.5, -1.0, -0.5, 0.0]) {
      let brier = 0;
      for (let i = 0; i < historicalScores.length; i++) {
        const prob = sigmoid(historicalScores[i], slope, intercept);
        const outcome = actualOutcomes[i];
        // Brier score: (prob - outcome)^2
        brier += (prob - outcome) ** 2;
      }
      brier /= historicalScores.length;

      if (brier < bestBrier) {
        bestBrier = brier;
        bestSlope = slope;
        bestIntercept = intercept;
      }
    }
  }

  return { slope: bestSlope, intercept: bestIntercept };
}

/**
 * Get BUY/SELL/HOLD decision from probabilities
 * Returns the decision with highest probability
 */
export function getDecisionFromProbabilities(result: ProbabilityResult): string {
  const { buyProbability, sellProbability, holdProbability } = result;

  if (buyProbability > sellProbability && buyProbability > holdProbability) {
    return 'BUY';
  }
  if (sellProbability > buyProbability && sellProbability > holdProbability) {
    return 'SELL';
  }
  return 'HOLD';
}
