import { describe, expect, it, vi } from "vitest";
import { NoMatchingServiceError, checkLeg } from "../../src/rtt/checkLeg.js";
import type { RttClient } from "../../src/rtt/client.js";
import type { RttSearchResponse, RttServiceResponse } from "../../src/rtt/types.js";
import type { Leg } from "../../src/engine/types.js";

function fakeClient(
  search: RttSearchResponse,
  servicesByUid: Record<string, RttServiceResponse>,
): RttClient {
  return {
    searchStationToStation: vi.fn().mockResolvedValue(search),
    getService: vi.fn(async (uid: string) => servicesByUid[uid]),
  } as unknown as RttClient;
}

const leg: Leg = {
  fromCrs: "STP",
  toCrs: "BTN",
  date: new Date(2026, 8, 23),
  bookedDepartureTime: "0812",
};

describe("checkLeg", () => {
  it("evaluates the closest matching service against later alternatives", async () => {
    const search: RttSearchResponse = {
      location: { name: "St Pancras", crs: "STP" },
      services: [
        {
          serviceUid: "TAKEN",
          runDate: "2026-09-23",
          atocCode: "TL",
          atocName: "Thameslink",
          serviceType: "train",
          isPassenger: true,
          locationDetail: { gbttBookedDeparture: "0812", origin: [], destination: [] },
        },
        {
          serviceUid: "ALT",
          runDate: "2026-09-23",
          atocCode: "TL",
          atocName: "Thameslink",
          serviceType: "train",
          isPassenger: true,
          locationDetail: { gbttBookedDeparture: "0842", origin: [], destination: [] },
        },
      ],
    };

    const servicesByUid: Record<string, RttServiceResponse> = {
      TAKEN: {
        serviceUid: "TAKEN",
        runDate: "2026-09-23",
        atocCode: "TL",
        atocName: "Thameslink",
        locations: [
          { crs: "STP", description: "St Pancras", gbttBookedDeparture: "0812" },
          {
            crs: "BTN",
            description: "Brighton",
            gbttBookedArrival: "0910",
            realtimeArrival: "0932",
            realtimeArrivalActual: true,
          },
        ],
      },
      ALT: {
        serviceUid: "ALT",
        runDate: "2026-09-23",
        atocCode: "TL",
        atocName: "Thameslink",
        locations: [
          { crs: "STP", description: "St Pancras", gbttBookedDeparture: "0842" },
          {
            crs: "BTN",
            description: "Brighton",
            gbttBookedArrival: "0940",
            realtimeArrival: "0958",
            realtimeArrivalActual: true,
          },
        ],
      },
    };

    const client = fakeClient(search, servicesByUid);
    const result = await checkLeg(client, leg);

    expect(result.taken.serviceUid).toBe("TAKEN");
    expect(result.delayMinutes).toBe(22);
    expect(result.compensation.eligible).toBe(true);
    expect(result.alternatives.checkedCount).toBe(1);
    expect(result.alternatives.fasterAlternativeFound).toBe(false);
  });

  it("throws NoMatchingServiceError when nothing matches", async () => {
    const emptySearch: RttSearchResponse = { location: { name: "St Pancras", crs: "STP" }, services: [] };
    const client = fakeClient(emptySearch, {});

    await expect(checkLeg(client, leg)).rejects.toThrow(NoMatchingServiceError);
  });
});
