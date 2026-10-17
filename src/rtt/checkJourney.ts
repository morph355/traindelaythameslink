import { evaluateLeg } from "../engine/delayRepay.js";
import type { Leg, LegResult, ServicePerformance } from "../engine/types.js";
import {
  findAlternativeCandidates,
  findClosestService,
  toLondonHHmm,
  toServicePerformance,
} from "./adapter.js";
import type { RttClient } from "./client.js";
import type { RttLocationSearchResponse, RttServiceDetailResponse } from "./types.js";

/** Cap on how many alternative services get an extra API call, to keep this fast and polite to the API. */
export const MAX_ALTERNATIVES_CHECKED = 3;

export class NoMatchingServiceError extends Error {
  constructor(leg: Leg) {
    super(
      `No service found from ${leg.fromCrs} to ${leg.toCrs} on ${leg.date.toDateString()} near ${leg.bookedDepartureTime}`,
    );
    this.name = "NoMatchingServiceError";
  }
}

export interface JourneySpec {
  fromCrs: string;
  /**
   * Where a split-save pair is split. Omit for a single ticket covering the
   * whole journey: the result then has one leg instead of two.
   */
  viaCrs?: string;
  toCrs: string;
  date: Date;
  /** Booked departure time from `fromCrs`, HHmm. */
  bookedDepartureTime: string;
  /**
   * Departure time from `fromCrs` (HHmm) of the train actually arrived on, if
   * the booked one was cancelled or terminated early. Delay is then measured
   * from the booked service's scheduled arrival to this train's actual arrival,
   * for each ticket whose destination the booked service didn't reach.
   */
  tookDepartureTime?: string;
  /** `leg1` labels the first (or only) ticket, `leg2` the second. */
  ticketLabels?: { leg1?: string; leg2?: string };
}

/**
 * Evaluates Delay Repay for a journey on a single through service: either one
 * ticket for the whole way, or a two-ticket split-save pair (e.g. Brighton ->
 * Gatwick Airport + Gatwick Airport -> London Bridge, both covered by the same
 * physical train). Looks the booked service up once, then derives each
 * ticket's own delay/eligibility from that one service's performance at its
 * own destination - so only one departure time needs to be known, not one per
 * ticket.
 */
export async function checkJourney(client: RttClient, spec: JourneySpec): Promise<LegResult[]> {
  const wholeJourneyLeg: Leg = {
    fromCrs: spec.fromCrs,
    toCrs: spec.toCrs,
    date: spec.date,
    bookedDepartureTime: spec.bookedDepartureTime,
  };

  const search = await client.searchStationToStation(spec.fromCrs, spec.toCrs, spec.date, spec.bookedDepartureTime);
  const matched = findClosestService(search, spec.bookedDepartureTime);
  if (!matched) throw new NoMatchingServiceError(wholeJourneyLeg);

  const bookedDetail = await client.getService(matched.scheduleMetadata.identity, spec.date);

  const legs = await buildLegs(spec, bookedDetail, matched.scheduleMetadata.uniqueIdentity);

  let tookDetail: RttServiceDetailResponse | undefined;
  if (spec.tookDepartureTime && spec.tookDepartureTime !== spec.bookedDepartureTime) {
    const tookMatched = findClosestService(search, spec.tookDepartureTime);
    if (!tookMatched) throw new NoMatchingServiceError({ ...wholeJourneyLeg, bookedDepartureTime: spec.tookDepartureTime });
    if (tookMatched.scheduleMetadata.uniqueIdentity !== matched.scheduleMetadata.uniqueIdentity) {
      tookDetail = await client.getService(tookMatched.scheduleMetadata.identity, spec.date);
    }
  }

  const excludeUid = matched.scheduleMetadata.uniqueIdentity;
  return Promise.all(
    legs.map(async (leg) => {
      const travelled = performanceFor(bookedDetail, tookDetail, leg.toCrs, leg.fromCrs);
      // A single-ticket journey is the whole search already; a split leg needs its own.
      const legSearch = leg.fromCrs === spec.fromCrs && leg.toCrs === spec.toCrs ? search : undefined;
      const alternatives = await findAlternatives(client, leg, excludeUid, legSearch);
      return evaluateLeg(leg, travelled, alternatives);
    }),
  );
}

/** The ticketed legs: the whole journey, or two halves split where the booked service calls at `viaCrs`. */
async function buildLegs(spec: JourneySpec, bookedDetail: RttServiceDetailResponse, bookedUid: string): Promise<Leg[]> {
  if (!spec.viaCrs) {
    return [
      {
        fromCrs: spec.fromCrs,
        toCrs: spec.toCrs,
        date: spec.date,
        bookedDepartureTime: spec.bookedDepartureTime,
        ticketLabel: spec.ticketLabels?.leg1,
      },
    ];
  }

  const viaCrs = spec.viaCrs;
  const viaLocation = bookedDetail.service?.locations.find((loc) => (loc.location?.shortCodes ?? []).includes(viaCrs));
  const leg2BookedDeparture = toLondonHHmm(viaLocation?.temporalData?.departure?.scheduleAdvertised);
  if (!leg2BookedDeparture) {
    throw new Error(`Service ${bookedUid} on ${spec.date.toDateString()} doesn't appear to call at ${viaCrs}`);
  }
  return [
    {
      fromCrs: spec.fromCrs,
      toCrs: viaCrs,
      date: spec.date,
      bookedDepartureTime: spec.bookedDepartureTime,
      ticketLabel: spec.ticketLabels?.leg1,
    },
    {
      fromCrs: viaCrs,
      toCrs: spec.toCrs,
      date: spec.date,
      bookedDepartureTime: leg2BookedDeparture,
      ticketLabel: spec.ticketLabels?.leg2,
    },
  ];
}

/**
 * How the passenger's journey went at `crs`: on the booked service where it
 * actually got there, otherwise on the train they say they took instead
 * (measured against the booked service's scheduled arrival).
 */
function performanceFor(
  booked: RttServiceDetailResponse,
  took: RttServiceDetailResponse | undefined,
  crs: string,
  legOriginCrs: string,
): ServicePerformance {
  const bookedPerf = toServicePerformance(booked, crs, legOriginCrs);
  if (!took || (!bookedPerf.cancelled && bookedPerf.actualArrival)) return bookedPerf;

  const tookPerf = toServicePerformance(took, crs, legOriginCrs);
  return {
    ...tookPerf,
    scheduledArrival: bookedPerf.scheduledArrival,
    // The passenger was on the booked train from this leg's start (it only fell short later), so its
    // departure is the one that counts, not the departure of the train taken afterwards.
    legScheduledDeparture: bookedPerf.legScheduledDeparture,
    legActualDeparture: bookedPerf.legActualDeparture,
    delayReason: bookedPerf.delayReason ?? tookPerf.delayReason,
    replacesServiceUid: bookedPerf.serviceUid,
  };
}

async function findAlternatives(
  client: RttClient,
  leg: Leg,
  excludeUid: string,
  prefetched?: RttLocationSearchResponse,
): Promise<ServicePerformance[]> {
  const search =
    prefetched ?? (await client.searchStationToStation(leg.fromCrs, leg.toCrs, leg.date, leg.bookedDepartureTime));
  const candidates = findAlternativeCandidates(search, leg.bookedDepartureTime, excludeUid).slice(
    0,
    MAX_ALTERNATIVES_CHECKED,
  );
  const details = await Promise.all(candidates.map((c) => client.getService(c.scheduleMetadata.identity, leg.date)));
  return details.map((d) => toServicePerformance(d, leg.toCrs));
}
