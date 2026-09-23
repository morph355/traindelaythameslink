import { describe, expect, it, vi } from "vitest";
import { checkSplitJourney } from "../../src/rtt/checkSplitJourney.js";
import { NoMatchingServiceError } from "../../src/rtt/checkLeg.js";
import type { RttClient } from "../../src/rtt/client.js";
import type { RttSearchResponse, RttSearchService, RttServiceResponse } from "../../src/rtt/types.js";

function searchService(uid: string, departure: string): RttSearchService {
  return {
    serviceUid: uid,
    runDate: "2026-09-23",
    atocCode: "TL",
    atocName: "Thameslink",
    serviceType: "train",
    isPassenger: true,
    locationDetail: { gbttBookedDeparture: departure, origin: [], destination: [] },
  };
}

const takenDetail: RttServiceResponse = {
  serviceUid: "TAKEN",
  runDate: "2026-09-23",
  atocCode: "TL",
  atocName: "Thameslink",
  locations: [
    { crs: "BTN", description: "Brighton", gbttBookedDeparture: "0639" },
    {
      crs: "GTW",
      description: "Gatwick Airport",
      gbttBookedArrival: "0705",
      gbttBookedDeparture: "0707",
      realtimeArrival: "0719",
      realtimeArrivalActual: true,
    },
    {
      crs: "LBG",
      description: "London Bridge",
      gbttBookedArrival: "0755",
      realtimeArrival: "0825",
      realtimeArrivalActual: true,
    },
  ],
};

const altLeg1Detail: RttServiceResponse = {
  serviceUid: "ALT_LEG1",
  runDate: "2026-09-23",
  atocCode: "TL",
  atocName: "Thameslink",
  locations: [
    { crs: "BTN", description: "Brighton", gbttBookedDeparture: "0645" },
    {
      crs: "GTW",
      description: "Gatwick Airport",
      gbttBookedArrival: "0730",
      realtimeArrival: "0733",
      realtimeArrivalActual: true,
    },
  ],
};

const altLeg2Detail: RttServiceResponse = {
  serviceUid: "ALT_LEG2",
  runDate: "2026-09-23",
  atocCode: "TL",
  atocName: "Thameslink",
  locations: [
    { crs: "GTW", description: "Gatwick Airport", gbttBookedDeparture: "0715" },
    {
      crs: "LBG",
      description: "London Bridge",
      gbttBookedArrival: "0800",
      realtimeArrival: "0803",
      realtimeArrivalActual: true,
    },
  ],
};

function fakeClient(): RttClient {
  const searchStationToStation = vi.fn(
    async (fromCrs: string, toCrs: string, _date: Date, time?: string): Promise<RttSearchResponse> => {
      if (fromCrs === "BTN" && toCrs === "LBG") {
        return { location: { name: "Brighton", crs: "BTN" }, services: [searchService("TAKEN", "0639")] };
      }
      if (fromCrs === "BTN" && toCrs === "GTW") {
        return {
          location: { name: "Brighton", crs: "BTN" },
          services: [searchService("TAKEN", "0639"), searchService("ALT_LEG1", "0645")],
        };
      }
      if (fromCrs === "GTW" && toCrs === "LBG") {
        return {
          location: { name: "Gatwick Airport", crs: "GTW" },
          services: [searchService("TAKEN", "0707"), searchService("ALT_LEG2", "0715")],
        };
      }
      throw new Error(`Unexpected search ${fromCrs}->${toCrs} at ${time}`);
    },
  );

  const services: Record<string, RttServiceResponse> = {
    TAKEN: takenDetail,
    ALT_LEG1: altLeg1Detail,
    ALT_LEG2: altLeg2Detail,
  };
  const getService = vi.fn(async (uid: string) => services[uid]);

  return { searchStationToStation, getService } as unknown as RttClient;
}

describe("checkSplitJourney", () => {
  it("derives both ticket legs from a single through service and checks alternatives per leg", async () => {
    const client = fakeClient();

    const [leg1Result, leg2Result] = await checkSplitJourney(client, {
      fromCrs: "BTN",
      viaCrs: "GTW",
      toCrs: "LBG",
      date: new Date(2026, 8, 23),
      bookedDepartureTime: "0639",
      ticketLabels: { leg1: "Brighton to Gatwick Airport", leg2: "Gatwick Airport to London Bridge" },
    });

    expect(leg1Result.leg.fromCrs).toBe("BTN");
    expect(leg1Result.leg.toCrs).toBe("GTW");
    expect(leg1Result.delayMinutes).toBe(14);
    expect(leg1Result.compensation.eligible).toBe(false);
    expect(leg1Result.alternatives.checkedCount).toBe(1);

    expect(leg2Result.leg.fromCrs).toBe("GTW");
    expect(leg2Result.leg.toCrs).toBe("LBG");
    expect(leg2Result.leg.bookedDepartureTime).toBe("0707");
    expect(leg2Result.delayMinutes).toBe(30);
    expect(leg2Result.compensation.eligible).toBe(true);
    expect(leg2Result.compensation.percentOfFare).toBe(50);
    expect(leg2Result.alternatives.checkedCount).toBe(1);
  });

  it("throws NoMatchingServiceError when no through service is found", async () => {
    const client = {
      searchStationToStation: vi.fn().mockResolvedValue({ location: { name: "Brighton", crs: "BTN" }, services: [] }),
      getService: vi.fn(),
    } as unknown as RttClient;

    await expect(
      checkSplitJourney(client, {
        fromCrs: "BTN",
        viaCrs: "GTW",
        toCrs: "LBG",
        date: new Date(2026, 8, 23),
        bookedDepartureTime: "0639",
      }),
    ).rejects.toThrow(NoMatchingServiceError);
  });

  it("throws when the matched service doesn't call at the via station", async () => {
    const client = {
      searchStationToStation: vi.fn().mockResolvedValue({
        location: { name: "Brighton", crs: "BTN" },
        services: [searchService("TAKEN", "0639")],
      }),
      getService: vi.fn().mockResolvedValue({
        serviceUid: "TAKEN",
        runDate: "2026-09-23",
        atocCode: "TL",
        atocName: "Thameslink",
        locations: [{ crs: "BTN", description: "Brighton", gbttBookedDeparture: "0639" }],
      }),
    } as unknown as RttClient;

    await expect(
      checkSplitJourney(client, {
        fromCrs: "BTN",
        viaCrs: "GTW",
        toCrs: "LBG",
        date: new Date(2026, 8, 23),
        bookedDepartureTime: "0639",
      }),
    ).rejects.toThrow(/doesn't appear to call at GTW/);
  });
});
