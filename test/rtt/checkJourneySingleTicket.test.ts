import { describe, expect, it, vi } from "vitest";
import { NoMatchingServiceError, checkJourney, type JourneySpec } from "../../src/rtt/checkJourney.js";
import type { RttClient } from "../../src/rtt/client.js";
import type { RttLocationSearchResponse, RttServiceDetailResponse } from "../../src/rtt/types.js";

function fakeClient(
  search: RttLocationSearchResponse,
  servicesByIdentity: Record<string, RttServiceDetailResponse>,
): RttClient {
  return {
    searchStationToStation: vi.fn().mockResolvedValue(search),
    getService: vi.fn(async (identity: string) => servicesByIdentity[identity]),
  } as unknown as RttClient;
}

const spec: JourneySpec = {
  fromCrs: "STP",
  toCrs: "BTN",
  date: new Date(2026, 8, 23),
  bookedDepartureTime: "0812",
};

describe("checkJourney with a single ticket", () => {
  it("evaluates the closest matching service against later alternatives", async () => {
    const search: RttLocationSearchResponse = {
      services: [
        {
          scheduleMetadata: {
            uniqueIdentity: "gb-nr:TAKEN:2026-09-23",
            namespace: "gb-nr",
            identity: "TAKEN",
            departureDate: "2026-09-23",
            inPassengerService: true,
          },
          temporalData: { departure: { scheduleAdvertised: "2026-09-23T07:12:00Z" } },
        },
        {
          scheduleMetadata: {
            uniqueIdentity: "gb-nr:ALT:2026-09-23",
            namespace: "gb-nr",
            identity: "ALT",
            departureDate: "2026-09-23",
            inPassengerService: true,
          },
          temporalData: { departure: { scheduleAdvertised: "2026-09-23T07:42:00Z" } },
        },
      ],
    };

    const servicesByIdentity: Record<string, RttServiceDetailResponse> = {
      TAKEN: {
        service: {
          scheduleMetadata: {
            uniqueIdentity: "gb-nr:TAKEN:2026-09-23",
            namespace: "gb-nr",
            identity: "TAKEN",
            departureDate: "2026-09-23",
          },
          locations: [
            { location: { shortCodes: ["STP"] }, temporalData: { departure: { scheduleAdvertised: "2026-09-23T07:12:00Z" } } },
            {
              location: { shortCodes: ["BTN"] },
              temporalData: {
                arrival: {
                  scheduleAdvertised: "2026-09-23T08:10:00Z",
                  realtimeActual: "2026-09-23T08:32:00Z",
                  realtimeNoReport: false,
                },
              },
            },
          ],
        },
      },
      ALT: {
        service: {
          scheduleMetadata: {
            uniqueIdentity: "gb-nr:ALT:2026-09-23",
            namespace: "gb-nr",
            identity: "ALT",
            departureDate: "2026-09-23",
          },
          locations: [
            { location: { shortCodes: ["STP"] }, temporalData: { departure: { scheduleAdvertised: "2026-09-23T07:42:00Z" } } },
            {
              location: { shortCodes: ["BTN"] },
              temporalData: {
                arrival: {
                  scheduleAdvertised: "2026-09-23T08:40:00Z",
                  realtimeActual: "2026-09-23T08:58:00Z",
                  realtimeNoReport: false,
                },
              },
            },
          ],
        },
      },
    };

    const client = fakeClient(search, servicesByIdentity);
    const [result, ...rest] = await checkJourney(client, spec);
    expect(rest).toHaveLength(0);

    expect(result.taken.serviceUid).toBe("gb-nr:TAKEN:2026-09-23");
    expect(result.delayMinutes).toBe(22);
    expect(result.compensation.eligible).toBe(true);
    expect(result.alternatives.checkedCount).toBe(1);
    expect(result.alternatives.fasterAlternativeFound).toBe(false);
  });

  it("throws NoMatchingServiceError when nothing matches", async () => {
    const client = fakeClient({ services: [] }, {});

    await expect(checkJourney(client, spec)).rejects.toThrow(NoMatchingServiceError);
  });
});
