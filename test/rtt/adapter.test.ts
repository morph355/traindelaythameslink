import { describe, expect, it } from "vitest";
import {
  findAlternativeCandidates,
  findClosestService,
  toLondonHHmm,
  toServicePerformance,
} from "../../src/rtt/adapter.js";
import type {
  RttLocationLineUpItem,
  RttLocationSearchResponse,
  RttServiceDetailResponse,
} from "../../src/rtt/types.js";

function searchItem(overrides: Partial<RttLocationLineUpItem> = {}): RttLocationLineUpItem {
  return {
    scheduleMetadata: {
      uniqueIdentity: "gb-nr:L00001:2026-09-23",
      namespace: "gb-nr",
      identity: "L00001",
      departureDate: "2026-09-23",
      inPassengerService: true,
    },
    temporalData: {
      departure: { scheduleAdvertised: "2026-09-23T05:39:00Z" },
    },
    ...overrides,
  };
}

describe("toLondonHHmm", () => {
  it("converts a UTC datetime during BST to correct local HHmm", () => {
    // 05:39 UTC on 23 Sept 2026 (BST, UTC+1) is 06:39 local. (The live API
    // actually sends offset-less local times - see the next tests - but an
    // explicit Z/offset must still convert correctly.)
    expect(toLondonHHmm("2026-09-23T05:39:00Z")).toBe("0639");
  });

  it("converts a UTC datetime during GMT (winter) to correct local HHmm", () => {
    expect(toLondonHHmm("2026-01-15T06:39:00Z")).toBe("0639");
  });

  it("reads the live API's offset-less datetimes as UK local time, with no BST shift", () => {
    // Real data.rtt.io responses look like this: already local, no Z or offset.
    expect(toLondonHHmm("2026-10-03T06:58:00")).toBe("0658");
    expect(toLondonHHmm("2026-01-15T06:58:00")).toBe("0658");
  });

  it("converts datetimes with an explicit offset to UK local time", () => {
    expect(toLondonHHmm("2026-09-23T06:39:00+01:00")).toBe("0639");
    expect(toLondonHHmm("2026-09-23T06:39:00+00:00")).toBe("0739");
  });

  it("returns undefined for an undefined input", () => {
    expect(toLondonHHmm(undefined)).toBeUndefined();
  });
});

describe("toServicePerformance", () => {
  it("extracts scheduled/actual arrival at the destination CRS", () => {
    const service: RttServiceDetailResponse = {
      service: {
        scheduleMetadata: {
          uniqueIdentity: "gb-nr:L00001:2026-09-23",
          namespace: "gb-nr",
          identity: "L00001",
          departureDate: "2026-09-23",
        },
        locations: [
          {
            location: { shortCodes: ["BTN"] },
            temporalData: { departure: { scheduleAdvertised: "2026-09-23T05:39:00Z" } },
          },
          {
            location: { shortCodes: ["GTW"] },
            temporalData: {
              arrival: {
                scheduleAdvertised: "2026-09-23T06:05:00Z",
                realtimeActual: "2026-09-23T06:19:00Z",
                realtimeNoReport: false,
              },
            },
          },
        ],
      },
    };

    const perf = toServicePerformance(service, "GTW");

    expect(perf).toEqual({
      serviceUid: "gb-nr:L00001:2026-09-23",
      runDate: "2026-09-23",
      scheduledDeparture: "0639",
      scheduledArrival: "0705",
      actualArrival: "0719",
      arrivalIsActual: true,
      cancelled: false,
    });
  });

  it("marks cancelled when the destination call was cancelled", () => {
    const service: RttServiceDetailResponse = {
      service: {
        scheduleMetadata: {
          uniqueIdentity: "gb-nr:L1:2026-09-23",
          namespace: "gb-nr",
          identity: "L1",
          departureDate: "2026-09-23",
        },
        locations: [{ location: { shortCodes: ["GTW"] }, temporalData: { arrival: { isCancelled: true } } }],
      },
    };

    expect(toServicePerformance(service, "GTW").cancelled).toBe(true);
  });

  it("reads the leg's own departure and the published delay reason", () => {
    const service: RttServiceDetailResponse = {
      service: {
        scheduleMetadata: { uniqueIdentity: "gb-nr:W1:2026-09-23", namespace: "gb-nr", identity: "W1", departureDate: "2026-09-23" },
        reasons: [{ type: "CANCEL", code: "MN", shortText: "train fault", longText: "a problem with the brakes" }],
        locations: [
          { location: { shortCodes: ["BTN"] }, temporalData: { departure: { scheduleAdvertised: "2026-09-23T06:56:00", realtimeActual: "2026-09-23T06:56:00" } } },
          {
            location: { shortCodes: ["GTW"] },
            temporalData: {
              arrival: { scheduleAdvertised: "2026-09-23T07:35:00", realtimeActual: "2026-09-23T07:50:00" },
              departure: { scheduleAdvertised: "2026-09-23T07:36:00", realtimeActual: "2026-09-23T07:51:00" },
            },
          },
          { location: { shortCodes: ["LBG"] }, temporalData: { arrival: { scheduleAdvertised: "2026-09-23T08:05:00", realtimeActual: "2026-09-23T08:39:00" } } },
        ],
      },
    };

    const leg2 = toServicePerformance(service, "LBG", "GTW");
    expect(leg2.legScheduledDeparture).toBe("0736");
    expect(leg2.legActualDeparture).toBe("0751");
    expect(leg2.delayReason).toBe("train fault - a problem with the brakes");

    expect(toServicePerformance(service, "LBG").legScheduledDeparture).toBeUndefined();
    expect(toServicePerformance({ service: { ...service.service!, reasons: undefined } }, "LBG").delayReason).toBeUndefined();
  });

  it("throws when the response has no service data", () => {
    expect(() => toServicePerformance({}, "GTW")).toThrow(/no `service` data/);
  });
});

describe("findClosestService", () => {
  it("returns the exact match when the booked time matches", () => {
    const search: RttLocationSearchResponse = {
      services: [
        searchItem({
          scheduleMetadata: { uniqueIdentity: "EARLY", namespace: "gb-nr", identity: "EARLY", departureDate: "2026-09-23", inPassengerService: true },
          temporalData: { departure: { scheduleAdvertised: "2026-09-23T06:42:00Z" } },
        }),
        searchItem({
          scheduleMetadata: { uniqueIdentity: "EXACT", namespace: "gb-nr", identity: "EXACT", departureDate: "2026-09-23", inPassengerService: true },
          temporalData: { departure: { scheduleAdvertised: "2026-09-23T07:12:00Z" } },
        }),
      ],
    };

    expect(findClosestService(search, "0812")?.scheduleMetadata.uniqueIdentity).toBe("EXACT");
  });

  it("falls back to the nearest departure when there's no exact match", () => {
    const search: RttLocationSearchResponse = {
      services: [
        searchItem({
          scheduleMetadata: { uniqueIdentity: "FAR", namespace: "gb-nr", identity: "FAR", departureDate: "2026-09-23", inPassengerService: true },
          temporalData: { departure: { scheduleAdvertised: "2026-09-23T06:42:00Z" } },
        }),
        searchItem({
          scheduleMetadata: { uniqueIdentity: "NEAR", namespace: "gb-nr", identity: "NEAR", departureDate: "2026-09-23", inPassengerService: true },
          temporalData: { departure: { scheduleAdvertised: "2026-09-23T07:15:00Z" } },
        }),
      ],
    };

    expect(findClosestService(search, "0812")?.scheduleMetadata.uniqueIdentity).toBe("NEAR");
  });

  it("ignores non-passenger services", () => {
    const search: RttLocationSearchResponse = {
      services: [
        searchItem({
          scheduleMetadata: { uniqueIdentity: "FREIGHT", namespace: "gb-nr", identity: "FREIGHT", departureDate: "2026-09-23", inPassengerService: false },
          temporalData: { departure: { scheduleAdvertised: "2026-09-23T07:12:00Z" } },
        }),
      ],
    };

    expect(findClosestService(search, "0812")).toBeUndefined();
  });

  it("returns undefined when there are no services", () => {
    expect(findClosestService({ services: [] }, "0812")).toBeUndefined();
  });
});

describe("findAlternativeCandidates", () => {
  it("excludes the taken service and anything departing before the window", () => {
    const search: RttLocationSearchResponse = {
      services: [
        searchItem({
          scheduleMetadata: { uniqueIdentity: "TAKEN", namespace: "gb-nr", identity: "TAKEN", departureDate: "2026-09-23", inPassengerService: true },
          temporalData: { departure: { scheduleAdvertised: "2026-09-23T07:12:00Z" } },
        }),
        searchItem({
          scheduleMetadata: { uniqueIdentity: "TOO_EARLY", namespace: "gb-nr", identity: "TOO_EARLY", departureDate: "2026-09-23", inPassengerService: true },
          temporalData: { departure: { scheduleAdvertised: "2026-09-23T07:00:00Z" } },
        }),
        searchItem({
          scheduleMetadata: { uniqueIdentity: "LATER", namespace: "gb-nr", identity: "LATER", departureDate: "2026-09-23", inPassengerService: true },
          temporalData: { departure: { scheduleAdvertised: "2026-09-23T07:42:00Z" } },
        }),
      ],
    };

    const alternatives = findAlternativeCandidates(search, "0812", "TAKEN");

    expect(alternatives.map((s) => s.scheduleMetadata.uniqueIdentity)).toEqual(["LATER"]);
  });
});
