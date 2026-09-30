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
    // 05:39 UTC on 23 Sept 2026 (BST, UTC+1) is 06:39 local - RTT responses
    // always carry an explicit Z/offset (per the API spec), never a bare
    // local-time string like requests do.
    expect(toLondonHHmm("2026-09-23T05:39:00Z")).toBe("0639");
  });

  it("converts a UTC datetime during GMT (winter) to correct local HHmm", () => {
    expect(toLondonHHmm("2026-01-15T06:39:00Z")).toBe("0639");
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
