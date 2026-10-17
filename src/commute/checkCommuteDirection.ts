import type { LegResult } from "../engine/types.js";
import { buildCommuteJourneySpec, type CommuteDirection } from "../config/commute.js";
import { NoMatchingServiceError, checkJourney } from "../rtt/checkJourney.js";
import { RttApiError, type RttClient } from "../rtt/client.js";

export interface DirectionRequest {
  direction: CommuteDirection;
  date: Date;
  /** Booked departure time from the start of this direction, HHmm. */
  time: string;
  /** Departure time (HHmm) of the train actually arrived on, if the booked one fell short. */
  took?: string;
  /** One direct ticket for the whole direction instead of the split-save pair. */
  direct?: boolean;
}

export interface DirectionResult {
  direction: CommuteDirection;
  /** Two for a split-save pair, one for a single direct ticket. */
  legs: LegResult[];
}

/** Why RTT will never accept this request. Callers word it for their own audience. */
export type RejectionReason = "historyLimit" | "other";

/**
 * `noMatch` and `rejected` are permanent: retrying the same request can't change them.
 * Transient failures (RTT down, rate-limited) are not outcomes - they throw, so a caller
 * that polls can try again later.
 */
export type DirectionOutcome =
  | { kind: "ok"; result: DirectionResult }
  | { kind: "noMatch"; message: string }
  | { kind: "rejected"; reason: RejectionReason; message: string };

/** Checks one direction of the regular commute for Delay Repay eligibility. */
export async function checkCommuteDirection(client: RttClient, request: DirectionRequest): Promise<DirectionOutcome> {
  const spec = buildCommuteJourneySpec(request.direction, request.date, request.time, request.took, request.direct);
  try {
    const legs = await checkJourney(client, spec);
    return { kind: "ok", result: { direction: request.direction, legs } };
  } catch (err) {
    if (err instanceof NoMatchingServiceError) return { kind: "noMatch", message: err.message };
    // A 400 means RTT will never accept this request (e.g. a date older than the history it provides).
    if (err instanceof RttApiError && err.status === 400) {
      return {
        kind: "rejected",
        reason: /permitted history/i.test(err.message) ? "historyLimit" : "other",
        message: err.message,
      };
    }
    throw err;
  }
}
