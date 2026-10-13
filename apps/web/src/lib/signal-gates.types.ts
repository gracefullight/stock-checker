/**
 * Structured gate information the engine attaches to ticker and screen results.
 * The core contract is `blockedBy` (gate id string) + `checks[]` + `cluster`;
 * `SignalBlock` is the normalized object form the UI renders. Every field is
 * optional so responses that carry only string reasons keep rendering.
 */
export interface SignalCheck {
  /** Gate that evaluated the clause, e.g. `quality`, `trend`, `cluster`. */
  gate?: string;
  /** Stable check id, e.g. `ibs`, `atrPct`, `rsSpy`, `belowSma50`, `scoreMax`. */
  id: string;
  label?: string;
  passed: boolean;
  value?: number | string | boolean | null;
  limit?: number | string | boolean | null;
  /** How `value` relates to `limit` when the check passes, e.g. `<` or `>=`. */
  comparator?: string;
}

export interface SignalClusterState {
  lastSetupDate?: string | null;
  nextEligibleDate?: string | null;
  gapUnit?: 'calendar' | 'sessions';
  minGap?: number;
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
  /** Core sends the gate id; older fixtures and tests may send the object form. */
  blockedBy?: string | SignalBlock | null;
  checks?: SignalCheck[];
  cluster?: SignalClusterState | null;
  gateReasons?: string[];
  buyScore?: number;
  sellScore?: number;
  qualityBlocked?: boolean;
}

/** A core result whose gate fields may arrive in either shape. */
export type WithSignalGates<T> = Omit<T, keyof SignalGateExtras> & SignalGateExtras;

export interface SignalFingerprint {
  strategyId?: string | null;
  configSha256?: string | null;
}

/** Normalizes either blocker shape into the object the UI renders; null when nothing blocked. */
export function toSignalBlock(source: SignalGateExtras): SignalBlock | null {
  const { blockedBy } = source;
  if (!blockedBy) return null;
  if (typeof blockedBy !== 'string') return blockedBy;
  const checks = source.checks?.filter(
    (check) => check.gate === undefined || check.gate === blockedBy
  );
  return {
    gate: blockedBy,
    ...(checks && checks.length > 0 ? { checks } : {}),
    ...(source.cluster?.lastSetupDate ? { lastSetupDate: source.cluster.lastSetupDate } : {}),
    ...(source.cluster?.nextEligibleDate
      ? { nextEligibleDate: source.cluster.nextEligibleDate }
      : {}),
  };
}
