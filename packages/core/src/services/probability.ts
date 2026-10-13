/**
 * Normalized signal-score mapping. Legacy probability field names are retained
 * for API compatibility; these weights are not probabilities of trade success.
 * Sigmoid parameters are heuristic defaults; nothing fits them, and normalization
 * does not establish calibration against out-of-sample financial outcomes.
 */

export interface ProbabilityResult {
  buyProbability: number; // 0-100 normalized BUY score weight
  sellProbability: number; // 0-100 normalized exit-score weight; never short confidence
  holdProbability: number; // 0-100 normalized HOLD score weight
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
 * Convert buy and sell scores to normalized score weights
 * @param buyScore - Raw BUY indicator score
 * @param sellScore - Raw SELL indicator score
 * @param calibration - Optional calibration parameters {slope, intercept}
 * @returns Legacy result shape with a score-concentration label, not validated confidence
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
