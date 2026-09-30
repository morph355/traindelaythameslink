import { describe, expect, it, vi } from "vitest";
import { checkSplitJourney } from "../../src/rtt/checkSplitJourney.js";
import { NoMatchingServiceError } from "../../src/rtt/checkLeg.js";
import type { RttClient } from "../../src/rtt/client.js";
import type {
  RttLocationLineUpItem,
  RttLocationSearchResponse,
  RttServiceDetailResponse,
} from "../../src/rtt/types.js";

function searchItem(identity: string, departureIso: string): RttLocationLineUpItem {
  return {
    scheduleMetadata: {
      uniqueIdentity: `gb-nr:${identity}:2026-09-23`,
      namespace: "gb-nr",
      identity,
      departureDate: "2026-09-23",
      inPassengerService: true,
    },
    temporalData: { departure: { scheduleAdvertised: departureIso } },
  };
}

const takenDetail: RttServiceDetailResponse = {
  service: {
    scheduleMetadata: {
      uniqueIdentity: "gb-nr:TAKEN:2026-09-23",
      namespace: "gb-nr",
      identity: "TAKEN",
      departureDate: "2026-09-23",
    },
    locations: [
      { location: { shortCodes: ["BTN"] }, temporalData: { departure: { scheduleAdvertised: "2026-09-23T05:39:00Z" } } },
      {
        location: { shortCodes: ["GTW"] },
        temporalData: {
          arrival: { scheduleAdvertised: "2026-09-23T06:05:00Z", realtimeActual: "2026-09-23T06:19:00Z", realtimeNoReport: false },
          departure: { scheduleAdvertised: "2026-09-23T06:07:00Z" },
        },
      },
      {
        location: { shortCodes: ["LBG"] },
        temporalData: {
          arrival: { scheduleAdvertised: "2026-09-23T06:55:00Z", realtimeActual: "2026-09-23T07:25:00Z", realtimeNoReport: false },
        },
      },
    ],
  },
};

const altLeg1Detail: RttServiceDetailResponse = {
  service: {
    scheduleMetadata: {
      uniqueIdentity: "gb-nr:ALT_LEG1:2026-09-23",
      namespace: "gb-nr",
      identity: "ALT_LEG1",
      departureDate: "2026-09-23",
    },
    locations: [
      { location: { shortCodes: ["BTN"] }, temporalData: { departure: { scheduleAdvertised: "2026-09-23T05:45:00Z" } } },
      {
        location: { shortCodes: ["GTW"] },
        temporalData: {
          arrival: { scheduleAdvertised: "2026-09-23T06:30:00Z", realtimeActual: "2026-09-23T06:33:00Z", realtimeNoReport: false },
        },
      },
    ],
  },
};

const altLeg2Detail: RttServiceDetailResponse = {
  service: {
    scheduleMetadata: {
      uniqueIdentity: "gb-nr:ALT_LEG2:2026-09-23",
      namespace: "gb-nr",
      identity: "ALT_LEG2",
      departureDate: "2026-09-23",
    },
    locations: [
      { location: { shortCodes: ["GTW"] }, temporalData: { departure: { scheduleAdvertised: "2026-09-23T06:15:00Z" } } },
      {
        location: { shortCodes: ["LBG"] },
        temporalData: {
          arrival: { scheduleAdvertised: "2026-09-23T07:00:00Z", realtimeActual: "2026-09-23T07:03:00Z", realtimeNoReport: false },
        },
      },
    ],
  },
};

function fakeClient(): RttClient {
  const searchStationToStation = vi.fn(
    async (fromCrs: string, toCrs: string, _date: Date, time?: string): Promise<RttLocationSearchResponse> => {
      if (fromCrs === "BTN" && toCrs === "LBG") {
        return { services: [searchItem("TAKEN", "2026-09-23T05:39:00Z")] };
      }
      if (fromCrs === "BTN" && toCrs === "GTW") {
        return { services: [searchItem("TAKEN", "2026-09-23T05:39:00Z"), searchItem("ALT_LEG1", "2026-09-23T05:45:00Z")] };
      }
      if (fromCrs === "GTW" && toCrs === "LBG") {
        return { services: [searchItem("TAKEN", "2026-09-23T06:07:00Z"), searchItem("ALT_LEG2", "2026-09-23T06:15:00Z")] };
      }
      throw new Error(`Unexpected search ${fromCrs}->${toCrs} at ${time}`);
    },
  );

  const services: Record<string, RttServiceDetailResponse> = {
    TAKEN: takenDetail,
    ALT_LEG1: altLeg1Detail,
    ALT_LEG2: altLeg2Detail,
  };
  const getService = vi.fn(async (identity: string) => services[identity]);

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
      searchStationToStation: vi.fn().mockResolvedValue({ services: [] }),
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
      searchStationToStation: vi.fn().mockResolvedValue({ services: [searchItem("TAKEN", "2026-09-23T05:39:00Z")] }),
      getService: vi.fn().mockResolvedValue({
        service: {
          scheduleMetadata: {
            uniqueIdentity: "gb-nr:TAKEN:2026-09-23",
            namespace: "gb-nr",
            identity: "TAKEN",
            departureDate: "2026-09-23",
          },
          locations: [{ location: { shortCodes: ["BTN"] }, temporalData: { departure: { scheduleAdvertised: "2026-09-23T05:39:00Z" } } }],
        },
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
