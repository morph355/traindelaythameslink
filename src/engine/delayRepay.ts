import type {
  AlternativesSummary,
  CompensationTier,
  Leg,
  LegResult,
  ServicePerformance,
} from "./types.js";

/** Converts an HHmm string ("0812") to minutes since midnight. */
export function minutesOfDay(hhmm: string): number {
  const hours = Number(hhmm.slice(0, 2));
  const minutes = Number(hhmm.slice(2, 4));
  return hours * 60 + minutes;
}

/**
 * Minutes `actual` is later than `scheduled`, both HHmm. Assumes a delay of
 * more than 12 hours actually means the actual time rolled over past
 * midnight (rare, but possible on a severely delayed late-night service).
 */
export function delayMinutes(scheduled: string, actual: string): number {
  let diff = minutesOfDay(actual) - minutesOfDay(scheduled);
  if (diff < -12 * 60) diff += 24 * 60;
  return Math.max(0, diff);
}

// Standard "Delay Repay 15" tiers used across GB train operators, including
// GTR/Thameslink. Verify current rates at thameslinkrailway.com/help-and-support/delay-repay
// before relying on the exact percentage for a claim.
const TIERS: Array<{ minMinutes: number; label: string; percentOfFare: number }> = [
  { minMinutes: 120, label: "120+ minutes", percentOfFare: 100 },
  { minMinutes: 60, label: "60-119 minutes", percentOfFare: 100 },
  { minMinutes: 30, label: "30-59 minutes", percentOfFare: 50 },
  { minMinutes: 15, label: "15-29 minutes", percentOfFare: 25 },
];

export function compensationTier(delayMin: number): CompensationTier {
  const tier = TIERS.find((t) => delayMin >= t.minMinutes);
  if (!tier) {
    return { eligible: false, label: "Under 15 minutes - not eligible", percentOfFare: 0 };
  }
  return { eligible: true, label: tier.label, percentOfFare: tier.percentOfFare };
}

/**
 * Compares the service actually taken against candidate alternative services
 * on the same route, so a claim can show whether a genuinely faster,
 * undisrupted alternative existed - the evidence needed to pre-empt a
 * "you could have taken an alternative" rejection.
 */
export function summarizeAlternatives(
  taken: ServicePerformance,
  alternatives: ServicePerformance[],
): AlternativesSummary {
  const usable = alternatives.filter(
    (alt) => alt.serviceUid !== taken.serviceUid && !alt.cancelled && alt.actualArrival,
  );

  const lines: string[] = [];
  let best: ServicePerformance | undefined;

  for (const alt of usable) {
    const status = alt.arrivalIsActual ? "actual" : "estimated";
    lines.push(
      `${alt.serviceUid}: scheduled arrival ${alt.scheduledArrival ?? "?"}, ` +
        `${status} arrival ${alt.actualArrival} ` +
        `(${delayMinutes(alt.scheduledArrival ?? alt.actualArrival!, alt.actualArrival!)} min late)`,
    );
    if (
      alt.actualArrival &&
      (!best || minutesOfDay(alt.actualArrival) < minutesOfDay(best.actualArrival!))
    ) {
      best = alt;
    }
  }

  const takenArrival = taken.actualArrival ? minutesOfDay(taken.actualArrival) : undefined;
  const fasterAlternativeFound =
    !!best && !!best.actualArrival && takenArrival !== undefined
      ? minutesOfDay(best.actualArrival) < takenArrival
      : false;

  return {
    checkedCount: usable.length,
    fasterAlternativeFound,
    bestAlternativeArrival: best?.actualArrival,
    minutesEarlierThanTaken:
      fasterAlternativeFound && best?.actualArrival && takenArrival !== undefined
        ? takenArrival - minutesOfDay(best.actualArrival)
        : undefined,
    lines,
  };
}

export function evaluateLeg(
  leg: Leg,
  taken: ServicePerformance,
  alternatives: ServicePerformance[],
): LegResult {
  if (!taken.scheduledArrival || !taken.actualArrival) {
    throw new Error(
      `Cannot evaluate leg ${leg.fromCrs}->${leg.toCrs}: missing scheduled or actual arrival time`,
    );
  }
  const delay = delayMinutes(taken.scheduledArrival, taken.actualArrival);
  return {
    leg,
    taken,
    delayMinutes: delay,
    compensation: compensationTier(delay),
    alternatives: summarizeAlternatives(taken, alternatives),
  };
}
