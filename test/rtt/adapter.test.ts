import { describe, expect, it } from "vitest";
import {
  findAlternativeCandidates,
  findClosestService,
  toServicePerformance,
} from "../../src/rtt/adapter.js";
import type { RttSearchResponse, RttSearchService, RttServiceResponse } from "../../src/rtt/types.js";

function searchService(overrides: Partial<RttSearchService> = {}): RttSearchService {
  return {
    serviceUid: "G12345",
    runDate: "2026-09-23",
    atocCode: "TL",
    atocName: "Thameslink",
    serviceType: "train",
    isPassenger: true,
    locationDetail: {
      gbttBookedDeparture: "0812",
      origin: [{ description: "London St Pancras" }],
      destination: [{ description: "Brighton" }],
    },
    ...overrides,
  };
}

describe("toServicePerformance", () => {
  it("extracts scheduled/actual arrival at the destination CRS", () => {
    const service: RttServiceResponse = {
      serviceUid: "G12345",
      runDate: "2026-09-23",
      atocCode: "TL",
      atocName: "Thameslink",
      locations: [
        { crs: "STP", description: "London St Pancras", gbttBookedDeparture: "0812" },
        {
          crs: "BTN",
          description: "Brighton",
          gbttBookedArrival: "0910",
          realtimeArrival: "0932",
          realtimeArrivalActual: true,
        },
      ],
    };

    const perf = toServicePerformance(service, "BTN");

    expect(perf).toEqual({
      serviceUid: "G12345",
      runDate: "2026-09-23",
      scheduledDeparture: "0812",
      scheduledArrival: "0910",
      actualArrival: "0932",
      arrivalIsActual: true,
      cancelled: false,
    });
  });

  it("marks cancelled when the destination call was cancelled", () => {
    const service: RttServiceResponse = {
      serviceUid: "G1",
      runDate: "2026-09-23",
      atocCode: "TL",
      atocName: "Thameslink",
      locations: [{ crs: "BTN", description: "Brighton", cancelled: true }],
    };

    expect(toServicePerformance(service, "BTN").cancelled).toBe(true);
  });
});

describe("findClosestService", () => {
  it("returns the exact match when the booked time matches", () => {
    const search: RttSearchResponse = {
      location: { name: "St Pancras", crs: "STP" },
      services: [
        searchService({ serviceUid: "EARLY", locationDetail: { gbttBookedDeparture: "0742", origin: [], destination: [] } }),
        searchService({ serviceUid: "EXACT", locationDetail: { gbttBookedDeparture: "0812", origin: [], destination: [] } }),
      ],
    };

    expect(findClosestService(search, "0812")?.serviceUid).toBe("EXACT");
  });

  it("falls back to the nearest departure when there's no exact match", () => {
    const search: RttSearchResponse = {
      location: { name: "St Pancras", crs: "STP" },
      services: [
        searchService({ serviceUid: "FAR", locationDetail: { gbttBookedDeparture: "0742", origin: [], destination: [] } }),
        searchService({ serviceUid: "NEAR", locationDetail: { gbttBookedDeparture: "0815", origin: [], destination: [] } }),
      ],
    };

    expect(findClosestService(search, "0812")?.serviceUid).toBe("NEAR");
  });

  it("returns undefined when there are no passenger services", () => {
    const search: RttSearchResponse = { location: { name: "St Pancras", crs: "STP" }, services: [] };
    expect(findClosestService(search, "0812")).toBeUndefined();
  });
});

describe("findAlternativeCandidates", () => {
  it("excludes the taken service and anything departing before the window", () => {
    const search: RttSearchResponse = {
      location: { name: "St Pancras", crs: "STP" },
      services: [
        searchService({ serviceUid: "TAKEN", locationDetail: { gbttBookedDeparture: "0812", origin: [], destination: [] } }),
        searchService({ serviceUid: "TOO_EARLY", locationDetail: { gbttBookedDeparture: "0800", origin: [], destination: [] } }),
        searchService({ serviceUid: "LATER", locationDetail: { gbttBookedDeparture: "0842", origin: [], destination: [] } }),
      ],
    };

    const alternatives = findAlternativeCandidates(search, "0812", "TAKEN");

    expect(alternatives.map((s) => s.serviceUid)).toEqual(["LATER"]);
  });
});
