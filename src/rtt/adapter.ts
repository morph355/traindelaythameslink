import type { ServicePerformance } from "../engine/types.js";
import { minutesOfDay } from "../engine/delayRepay.js";
import type { RttSearchResponse, RttSearchService, RttServiceResponse } from "./types.js";

/** Maps a full RTT service detail response into this app's domain type, for one destination CRS. */
export function toServicePerformance(
  service: RttServiceResponse,
  destinationCrs: string,
): ServicePerformance {
  const destination = service.locations.find((loc) => loc.crs === destinationCrs);
  return {
    serviceUid: service.serviceUid,
    runDate: service.runDate,
    scheduledDeparture: service.locations[0]?.gbttBookedDeparture,
    scheduledArrival: destination?.gbttBookedArrival,
    actualArrival: destination?.realtimeArrival,
    arrivalIsActual: destination?.realtimeArrivalActual ?? false,
    cancelled: Boolean(destination?.cancelled ?? service.cancelReason),
  };
}

/**
 * The passenger service in `search` whose booked departure is closest to
 * `bookedDepartureTime` (HHmm). Exact match wins; otherwise nearest by
 * absolute minute difference.
 */
export function findClosestService(
  search: RttSearchResponse,
  bookedDepartureTime: string,
): RttSearchService | undefined {
  const candidates = (search.services ?? []).filter(
    (s) => s.isPassenger && s.locationDetail.gbttBookedDeparture,
  );
  if (candidates.length === 0) return undefined;

  const targetMinutes = minutesOfDay(bookedDepartureTime);
  return candidates.reduce((closest, candidate) => {
    const candidateDiff = Math.abs(
      minutesOfDay(candidate.locationDetail.gbttBookedDeparture!) - targetMinutes,
    );
    const closestDiff = Math.abs(
      minutesOfDay(closest.locationDetail.gbttBookedDeparture!) - targetMinutes,
    );
    return candidateDiff < closestDiff ? candidate : closest;
  });
}

/**
 * Candidate alternative services: passenger services departing at or after
 * `fromTime` (HHmm), excluding `excludeUid` (the service actually taken).
 */
export function findAlternativeCandidates(
  search: RttSearchResponse,
  fromTime: string,
  excludeUid: string,
): RttSearchService[] {
  const fromMinutes = minutesOfDay(fromTime);
  return (search.services ?? []).filter(
    (s) =>
      s.isPassenger &&
      s.serviceUid !== excludeUid &&
      s.locationDetail.gbttBookedDeparture !== undefined &&
      minutesOfDay(s.locationDetail.gbttBookedDeparture) >= fromMinutes,
  );
}
