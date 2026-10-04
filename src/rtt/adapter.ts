import type { ServicePerformance } from "../engine/types.js";
import { minutesOfDay } from "../engine/delayRepay.js";
import type {
  RttLocationLineUpItem,
  RttLocationSearchResponse,
  RttServiceDetailResponse,
} from "./types.js";

const HAS_TIMEZONE = /(Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Converts an RTT ISO datetime to local UK clock time as an HHmm string,
 * independent of server timezone.
 *
 * The live RTT API returns offset-less datetimes (e.g. "2026-10-03T06:58:00")
 * which are already UK local time, so those are read as-is. Parsing them with
 * `new Date()` would treat them as the server's timezone (UTC in a container)
 * and shift every time by an hour during BST. Datetimes that do carry an
 * offset (Z or +01:00) are converted properly.
 */
export function toLondonHHmm(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  if (!HAS_TIMEZONE.test(iso)) {
    const match = /T(\d{2}):(\d{2})/.exec(iso);
    return match ? `${match[1]}${match[2]}` : undefined;
  }
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hour}${minute}`;
}

/** Maps a full RTT service detail response into this app's domain type, for one destination CRS. */
export function toServicePerformance(
  service: RttServiceDetailResponse,
  destinationCrs: string,
): ServicePerformance {
  const detail = service.service;
  if (!detail) {
    throw new Error("RTT service response had no `service` data");
  }

  const originDeparture = detail.locations[0]?.temporalData?.departure;
  const destination = detail.locations.find((loc) =>
    (loc.location?.shortCodes ?? []).includes(destinationCrs),
  );
  const arrival = destination?.temporalData?.arrival;

  return {
    serviceUid: detail.scheduleMetadata.uniqueIdentity,
    runDate: detail.scheduleMetadata.departureDate,
    scheduledDeparture: toLondonHHmm(originDeparture?.scheduleAdvertised),
    scheduledArrival: toLondonHHmm(arrival?.scheduleAdvertised),
    actualArrival: toLondonHHmm(arrival?.realtimeActual),
    arrivalIsActual: Boolean(arrival?.realtimeActual) && !arrival?.realtimeNoReport,
    cancelled: Boolean(arrival?.isCancelled),
  };
}

/**
 * The passenger service in `search` whose booked departure is closest to
 * `bookedDepartureTime` (HHmm). Exact match wins; otherwise nearest by
 * absolute minute difference.
 */
export function findClosestService(
  search: RttLocationSearchResponse,
  bookedDepartureTime: string,
): RttLocationLineUpItem | undefined {
  const candidates = (search.services ?? []).filter(
    (s) => s.scheduleMetadata.inPassengerService && s.temporalData?.departure?.scheduleAdvertised,
  );
  if (candidates.length === 0) return undefined;

  const targetMinutes = minutesOfDay(bookedDepartureTime);
  return candidates.reduce((closest, candidate) => {
    const candidateDiff = Math.abs(
      minutesOfDay(toLondonHHmm(candidate.temporalData!.departure!.scheduleAdvertised)!) - targetMinutes,
    );
    const closestDiff = Math.abs(
      minutesOfDay(toLondonHHmm(closest.temporalData!.departure!.scheduleAdvertised)!) - targetMinutes,
    );
    return candidateDiff < closestDiff ? candidate : closest;
  });
}

/**
 * Candidate alternative services: passenger services departing at or after
 * `fromTime` (HHmm), excluding `excludeUid` (the service actually taken).
 */
export function findAlternativeCandidates(
  search: RttLocationSearchResponse,
  fromTime: string,
  excludeUid: string,
): RttLocationLineUpItem[] {
  const fromMinutes = minutesOfDay(fromTime);
  return (search.services ?? []).filter((s) => {
    const departureIso = s.temporalData?.departure?.scheduleAdvertised;
    if (!s.scheduleMetadata.inPassengerService || !departureIso) return false;
    if (s.scheduleMetadata.uniqueIdentity === excludeUid) return false;
    return minutesOfDay(toLondonHHmm(departureIso)!) >= fromMinutes;
  });
}
