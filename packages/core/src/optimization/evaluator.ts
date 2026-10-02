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
 * Matches directional predictions against closes on a consistent price-history basis.
 * BUY/SELL correctness is a +/-2% direction diagnostic, not transaction profit;
 * SELL describes an exit signal, not a short position.
 * @param predictions List of prediction objects (from CSV)
 * @param priceHistory Map of Ticker -> ISO date -> consistently adjusted close price
 * @param daysForward Number of subsequent observed trading sessions to the outcome
 */
export function matchPredictions(
  predictions: PredictionInput[],
  priceHistory: Map<string, Map<string, number>>,
  daysForward = 5
): MatchedPrediction[] {
  const matched: MatchedPrediction[] = [];
  if (!Number.isInteger(daysForward) || daysForward <= 0) return matched;
  const sessionsByTicker = new Map<string, [string, number][]>();

  for (const p of predictions) {
    const dateStr = p.Date; // YYYY-MM-DD
    const ticker = p.Ticker;
    const opinion = p.Opinion;

    if (opinion === 'HOLD') continue;

    const history = priceHistory.get(ticker);
    if (!history) continue;

    let sessions = sessionsByTicker.get(ticker);
    if (!sessions) {
      sessions = [...history.entries()]
        .filter(([date]) => {
          const parsedDate = DateTime.fromISO(date);
          return parsedDate.isValid && parsedDate.toISODate() === date;
        })
        .sort(([left], [right]) => left.localeCompare(right));
      sessionsByTicker.set(ticker, sessions);
    }

    const entryIndex = sessions.findIndex(([date]) => date === dateStr);
    if (entryIndex === -1) continue;
    const currentPrice = sessions[entryIndex][1];
    const outcome = sessions[entryIndex + daysForward];
    if (!outcome || !Number.isFinite(currentPrice) || currentPrice <= 0) continue;
    const [foundDate, futurePrice] = outcome;
    // An invalid endpoint leaves the prediction unmatched; do not shift its horizon.
    if (!Number.isFinite(futurePrice) || futurePrice <= 0) continue;

    const change = (futurePrice - currentPrice) / currentPrice;
    if (!Number.isFinite(change)) continue;
    const isCorrect =
      (opinion === 'BUY' && change > 0.02) || (opinion === 'SELL' && change < -0.02);

    matched.push({
      ...p,
      futurePrice,
      outcomeDate: foundDate,
      change,
      isCorrect,
    });
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

  // Per-class precision and recall (BUY as positive class)
  const buyPredictions = matchedPredictions.filter((p) => p.Opinion === 'BUY');
  const truePositives = buyPredictions.filter((p) => p.isCorrect).length;
  const falsePositives = buyPredictions.filter((p) => !p.isCorrect).length;

  const sellPredictions = matchedPredictions.filter((p) => p.Opinion === 'SELL');
  // A failed SELL can be neutral or only slightly down. It is a missed BUY
  // positive only when the realized move exceeds the same BUY threshold.
  const falseNegatives = sellPredictions.filter((p) => p.change > 0.02).length;

  const precision =
    truePositives + falsePositives > 0 ? truePositives / (truePositives + falsePositives) : 0;
  const recall =
    truePositives + falseNegatives > 0 ? truePositives / (truePositives + falseNegatives) : 0;
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
