import { evaluateLeg } from "../engine/delayRepay.js";
import type { Leg, LegResult } from "../engine/types.js";
import { findAlternativeCandidates, findClosestService, toServicePerformance } from "./adapter.js";
import type { RttClient } from "./client.js";

/** Cap on how many alternative services get an extra API call, to keep this fast and polite to the API. */
export const MAX_ALTERNATIVES_CHECKED = 5;

export class NoMatchingServiceError extends Error {
  constructor(leg: Leg) {
    super(
      `No service found from ${leg.fromCrs} to ${leg.toCrs} on ${leg.date.toDateString()} near ${leg.bookedDepartureTime}`,
    );
    this.name = "NoMatchingServiceError";
  }
}

/**
 * Looks up the service the passenger actually took for `leg`, plus nearby
 * alternative services, and evaluates Delay Repay eligibility.
 */
export async function checkLeg(client: RttClient, leg: Leg): Promise<LegResult> {
  const search = await client.searchStationToStation(leg.fromCrs, leg.toCrs, leg.date, leg.bookedDepartureTime);

  const matched = findClosestService(search, leg.bookedDepartureTime);
  if (!matched) throw new NoMatchingServiceError(leg);

  const takenDetail = await client.getService(matched.serviceUid, leg.date);
  const taken = toServicePerformance(takenDetail, leg.toCrs);

  const candidates = findAlternativeCandidates(search, leg.bookedDepartureTime, matched.serviceUid).slice(
    0,
    MAX_ALTERNATIVES_CHECKED,
  );
  const alternativeDetails = await Promise.all(
    candidates.map((c) => client.getService(c.serviceUid, leg.date)),
  );
  const alternatives = alternativeDetails.map((d) => toServicePerformance(d, leg.toCrs));

  return evaluateLeg(leg, taken, alternatives);
}
