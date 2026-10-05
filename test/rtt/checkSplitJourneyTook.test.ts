import { describe, expect, it, vi } from "vitest";
import { checkSplitJourney } from "../../src/rtt/checkSplitJourney.js";
import type { RttClient } from "../../src/rtt/client.js";
import type {
  RttLocationLineUpItem,
  RttLocationSearchResponse,
  RttServiceDetailResponse,
} from "../../src/rtt/types.js";

// The real 23 Sept 2026 return: the 20:05 London Bridge service was cancelled
// from Three Bridges, so it reached Gatwick but never Brighton. The passenger
// carried on with the next train (the 20:15 from London Bridge). RTT sends
// offset-less local datetimes, as below.
const D = "2026-09-23";

function item(identity: string, departure: string): RttLocationLineUpItem {
  return {
    scheduleMetadata: { uniqueIdentity: `gb-nr:${identity}:${D}`, namespace: "gb-nr", identity, departureDate: D, inPassengerService: true },
    temporalData: { departure: { scheduleAdvertised: `${D}T${departure}:00` } },
  };
}

const t = (hhmm: string) => `${D}T${hhmm}:00`;

function service(
  identity: string,
  stops: Array<{ crs: string; arr?: [string, string?]; dep?: string; depActual?: string; cancelled?: boolean }>,
): RttServiceDetailResponse {
  return {
    service: {
      scheduleMetadata: { uniqueIdentity: `gb-nr:${identity}:${D}`, namespace: "gb-nr", identity, departureDate: D },
      locations: stops.map((s) => ({
        location: { shortCodes: [s.crs] },
        temporalData: {
          ...(s.arr && {
            arrival: {
              scheduleAdvertised: t(s.arr[0]),
              ...(s.arr[1] && { realtimeActual: t(s.arr[1]) }),
              ...(s.cancelled && { isCancelled: true }),
            },
          }),
          ...(s.dep && { departure: { scheduleAdvertised: t(s.dep), ...(s.depActual && { realtimeActual: t(s.depActual) }) } }),
        },
      })),
    },
  };
}

const booked = service("W45563", [
  { crs: "LBG", dep: "20:05" },
  { crs: "GTW", arr: ["20:34", "20:37"], dep: "20:35", depActual: "20:38" },
  { crs: "BTN", arr: ["21:13"], cancelled: true },
]);
const tookTrain = service("W45483", [
  { crs: "LBG", dep: "20:15" },
  { crs: "GTW", arr: ["20:44", "20:45"], dep: "20:45" },
  { crs: "BTN", arr: ["21:18", "21:29"] },
]);

function fakeClient(): RttClient {
  const searchStationToStation = vi.fn(async (from: string, to: string): Promise<RttLocationSearchResponse> => {
    if (from === "LBG") return { services: [item("W45563", "20:05"), item("W45483", "20:15")] };
    if (from === "GTW") return { services: [item("W45563", "20:35"), item("W45483", "20:45")] };
    throw new Error(`Unexpected search ${from}->${to}`);
  });
  const services: Record<string, RttServiceDetailResponse> = { W45563: booked, W45483: tookTrain };
  const getService = vi.fn(async (identity: string) => services[identity]);
  return { searchStationToStation, getService } as unknown as RttClient;
}

const spec = {
  fromCrs: "LBG",
  viaCrs: "GTW",
  toCrs: "BTN",
  date: new Date(2026, 8, 23),
  bookedDepartureTime: "2005",
};

describe("checkSplitJourney with a cancelled booked service", () => {
  it("measures the delay of the train you took against the booked service's scheduled arrival", async () => {
    const [leg1, leg2] = await checkSplitJourney(fakeClient(), { ...spec, tookDepartureTime: "2015" });

    // First ticket: the booked train did reach Gatwick (3 min late) - not eligible.
    expect(leg1.taken.serviceUid).toBe(`gb-nr:W45563:${D}`);
    expect(leg1.taken.replacesServiceUid).toBeUndefined();
    expect(leg1.delayMinutes).toBe(3);
    expect(leg1.compensation.eligible).toBe(false);

    // Second ticket: never reached Brighton - uses the train taken, due 21:13, arrived 21:29.
    expect(leg2.taken.serviceUid).toBe(`gb-nr:W45483:${D}`);
    expect(leg2.taken.replacesServiceUid).toBe(`gb-nr:W45563:${D}`);
    expect(leg2.taken.scheduledArrival).toBe("2113");
    expect(leg2.taken.actualArrival).toBe("2129");
    expect(leg2.taken.cancelled).toBe(false);
    expect(leg2.delayMinutes).toBe(16);
    // The booked train did leave Gatwick (before being cancelled later), and that's the departure that counts.
    expect(leg2.taken.legScheduledDeparture).toBe("2035");
    expect(leg2.taken.legActualDeparture).toBe("2038");
    expect(leg2.compensation).toMatchObject({ eligible: true, percentOfFare: 25 });
  });

  it("falls back to an estimate from the first alternative when no 'took' time is given", async () => {
    const [, leg2] = await checkSplitJourney(fakeClient(), spec);

    expect(leg2.taken.cancelled).toBe(true);
    expect(leg2.taken.replacesServiceUid).toBeUndefined();
    expect(leg2.compensation.label).toMatch(/Cancelled.*first alternative/);
  });

  it("ignores a 'took' time that is the same as the booked one", async () => {
    const [, leg2] = await checkSplitJourney(fakeClient(), { ...spec, tookDepartureTime: "2005" });
    expect(leg2.taken.cancelled).toBe(true);
    expect(leg2.taken.replacesServiceUid).toBeUndefined();
  });
});
