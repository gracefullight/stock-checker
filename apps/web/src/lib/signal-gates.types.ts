/**
 * Structured gate information the API may attach to ticker and screen results
 * after the engine starts returning machine-readable blockers. Every field is
 * optional so current responses (string reasons only) keep rendering.
 */
export interface SignalCheck {
  /** Stable check id, e.g. `ibs`, `atrPct`, `rsSpy`, `belowSma50`, `scoreMax`. */
  id: string;
  label?: string;
  passed: boolean;
  value?: number | null;
  limit?: number | null;
  /** How `value` relates to `limit` when the check passes, e.g. `<` or `>=`. */
  comparator?: string;
}

export interface SignalBlock {
  /** Gate that produced the HOLD: `trend`, `score`, `cluster`, `quality`, `confluence`, ... */
  gate: string;
  reason?: string;
  checks?: SignalCheck[];
  lastSetupDate?: string | null;
  nextEligibleDate?: string | null;
}

export interface SignalGateExtras {
  blockedBy?: SignalBlock | null;
  checks?: SignalCheck[];
  gateReasons?: string[];
  buyScore?: number;
  sellScore?: number;
  qualityBlocked?: boolean;
}

export interface SignalFingerprint {
  strategyId?: string | null;
  configSha256?: string | null;
}
