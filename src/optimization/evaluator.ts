import { DateTime } from 'luxon';

export interface AccuracyMetrics {
  hitRate: number;
  precision: number;
  recall: number;
  f1Score: number;
  totalPredictions: number;
  correctPredictions: number;
}

export interface PredictionInput {
  Date: string;
  Ticker: string;
  Result: string;
  Opinion: string;
  Close: string;
  Score?: number;
}

export interface MatchedPrediction extends PredictionInput {
  futurePrice: number;
  outcomeDate: string;
  change: number;
  isCorrect: boolean;
}

/**
 * Matches predictions with historical outcomes to determine correctness.
 * @param predictions List of prediction objects (from CSV)
 * @param priceHistory Map of Ticker -> Date -> ClosePrice
 * @param daysForward Days to look ahead for outcome
 */
export function matchPredictions(
  predictions: PredictionInput[],
  priceHistory: Map<string, Map<string, number>>,
  daysForward = 5
): MatchedPrediction[] {
  const matched: MatchedPrediction[] = [];

  for (const p of predictions) {
    const dateStr = p.Date; // YYYY-MM-DD
    const ticker = p.Ticker;
    const opinion = p.Opinion;

    if (opinion === 'HOLD') continue;

    const history = priceHistory.get(ticker);
    if (!history) continue;

    const currentPrice = parseFloat(p.Close);

    const dt = DateTime.fromISO(dateStr);
    let futurePrice: number | null = null;
    let foundDate = '';

    // Find price around target date
    for (let i = daysForward; i <= daysForward + 5; i++) {
      const fDt = dt.plus({ days: i });
      const fDateStr = fDt.toISODate();
      if (fDateStr && history.has(fDateStr)) {
        futurePrice = history.get(fDateStr) ?? null;
        foundDate = fDateStr;
        break;
      }
    }

    if (futurePrice !== null) {
      const change = (futurePrice - currentPrice) / currentPrice;
      let isCorrect = false;
      // Simple threshold: > 2% gain for BUY
      if (opinion === 'BUY' && change > 0.02) isCorrect = true;
      else if (opinion === 'SELL' && change < -0.02) isCorrect = true;

      matched.push({
        ...p,
        futurePrice,
        outcomeDate: foundDate,
        change,
        isCorrect,
      });
    }
  }
  return matched;
}

export function calculateMetrics(matchedPredictions: MatchedPrediction[]): AccuracyMetrics {
  const total = matchedPredictions.length;
  if (total === 0)
    return {
      hitRate: 0,
      precision: 0,
      recall: 0,
      f1Score: 0,
      totalPredictions: 0,
      correctPredictions: 0,
    };

  const correct = matchedPredictions.filter((p) => p.isCorrect).length;
  const hitRate = (correct / total) * 100;

  // Calculate binary classification metrics (Target: Correct Prediction)
  // This is a simplified view compared to full confusion matrix per class
  const precision = hitRate / 100;
  const recall = hitRate / 100;
  const f1Score = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  return {
    hitRate,
    precision,
    recall,
    f1Score,
    totalPredictions: total,
    correctPredictions: correct,
  };
}
