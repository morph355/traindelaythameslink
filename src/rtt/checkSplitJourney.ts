import { evaluateLeg } from "../engine/delayRepay.js";
import type { Leg, LegResult } from "../engine/types.js";
import { findAlternativeCandidates, findClosestService, toServicePerformance } from "./adapter.js";
import { MAX_ALTERNATIVES_CHECKED, NoMatchingServiceError } from "./checkLeg.js";
import type { RttClient } from "./client.js";

export interface SplitJourneySpec {
  fromCrs: string;
  viaCrs: string;
  toCrs: string;
  date: Date;
  /** Booked departure time from `fromCrs`, HHmm. */
  bookedDepartureTime: string;
  ticketLabels?: { leg1?: string; leg2?: string };
}

/**
 * Evaluates a two-ticket split-save journey that runs on a single through
 * service (e.g. Brighton -> Gatwick Airport + Gatwick Airport -> London
 * Bridge, both covered by the same physical train). Looks the through
 * service up once, then derives each ticket's own delay/eligibility from
 * that one service's performance at its own destination - so only one
 * departure time needs to be known, not one per ticket.
 */
export async function checkSplitJourney(
  client: RttClient,
  spec: SplitJourneySpec,
): Promise<[LegResult, LegResult]> {
  const wholeJourneyLeg: Leg = {
    fromCrs: spec.fromCrs,
    toCrs: spec.toCrs,
    date: spec.date,
    bookedDepartureTime: spec.bookedDepartureTime,
  };

  const search = await client.searchStationToStation(spec.fromCrs, spec.toCrs, spec.date, spec.bookedDepartureTime);
  const matched = findClosestService(search, spec.bookedDepartureTime);
  if (!matched) throw new NoMatchingServiceError(wholeJourneyLeg);

  const takenDetail = await client.getService(matched.serviceUid, spec.date);
  const viaLocation = takenDetail.locations.find((loc) => loc.crs === spec.viaCrs);
  if (!viaLocation?.gbttBookedDeparture) {
    throw new Error(
      `Service ${matched.serviceUid} on ${spec.date.toDateString()} doesn't appear to call at ${spec.viaCrs}`,
    );
  }
  const leg2BookedDeparture = viaLocation.gbttBookedDeparture;

  const leg1: Leg = {
    fromCrs: spec.fromCrs,
    toCrs: spec.viaCrs,
    date: spec.date,
    bookedDepartureTime: spec.bookedDepartureTime,
    ticketLabel: spec.ticketLabels?.leg1,
  };
  const leg2: Leg = {
    fromCrs: spec.viaCrs,
    toCrs: spec.toCrs,
    date: spec.date,
    bookedDepartureTime: leg2BookedDeparture,
    ticketLabel: spec.ticketLabels?.leg2,
  };

  const leg1Taken = toServicePerformance(takenDetail, spec.viaCrs);
  const leg2Taken = toServicePerformance(takenDetail, spec.toCrs);

  const [leg1Alternatives, leg2Alternatives] = await Promise.all([
    findAlternatives(client, leg1, matched.serviceUid),
    findAlternatives(client, leg2, matched.serviceUid),
  ]);

  return [
    evaluateLeg(leg1, leg1Taken, leg1Alternatives),
    evaluateLeg(leg2, leg2Taken, leg2Alternatives),
  ];
}

async function findAlternatives(client: RttClient, leg: Leg, excludeUid: string) {
  const search = await client.searchStationToStation(leg.fromCrs, leg.toCrs, leg.date, leg.bookedDepartureTime);
  const candidates = findAlternativeCandidates(search, leg.bookedDepartureTime, excludeUid).slice(
    0,
    MAX_ALTERNATIVES_CHECKED,
  );
  const details = await Promise.all(candidates.map((c) => client.getService(c.serviceUid, leg.date)));
  return details.map((d) => toServicePerformance(d, leg.toCrs));
}
