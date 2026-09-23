import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../src/server/app.js";
import type { RttClient } from "../../src/rtt/client.js";
import type { RttSearchResponse, RttServiceResponse } from "../../src/rtt/types.js";

function fakeClient(
  search: RttSearchResponse,
  servicesByUid: Record<string, RttServiceResponse>,
): RttClient {
  return {
    searchStationToStation: vi.fn().mockResolvedValue(search),
    getService: vi.fn(async (uid: string) => servicesByUid[uid]),
  } as unknown as RttClient;
}

const takenService: RttServiceResponse = {
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
};

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
  ],
};

describe("POST /api/check", () => {
  it("returns 400 with issues for invalid input", async () => {
    const app = createApp(fakeClient(search, { TAKEN: takenService }));

    const response = await request(app).post("/api/check").send({ legs: [] });

    expect(response.status).toBe(400);
    expect(response.body.issues).toContain("At least one leg is required");
  });

  it("returns eligibility results for a valid delayed leg", async () => {
    const app = createApp(fakeClient(search, { TAKEN: takenService }));

    const response = await request(app)
      .post("/api/check")
      .send({
        legs: [{ fromCrs: "STP", toCrs: "BTN", date: "2026-09-23", bookedDepartureTime: "0812" }],
      });

    expect(response.status).toBe(200);
    expect(response.body.results).toHaveLength(1);
    expect(response.body.results[0].delayMinutes).toBe(22);
    expect(response.body.results[0].compensation.eligible).toBe(true);
  });

  it("returns 404 when no matching service is found", async () => {
    const emptySearch: RttSearchResponse = { location: { name: "St Pancras", crs: "STP" }, services: [] };
    const app = createApp(fakeClient(emptySearch, {}));

    const response = await request(app)
      .post("/api/check")
      .send({
        legs: [{ fromCrs: "STP", toCrs: "BTN", date: "2026-09-23", bookedDepartureTime: "0812" }],
      });

    expect(response.status).toBe(404);
  });
});

describe("auth option", () => {
  it("leaves the app open when no auth is configured", async () => {
    const app = createApp(fakeClient(search, { TAKEN: takenService }));
    const response = await request(app).get("/api/commute");
    expect(response.status).toBe(200);
  });

  it("requires HTTP Basic Auth when auth is configured", async () => {
    const app = createApp(fakeClient(search, { TAKEN: takenService }), {
      auth: { username: "alice", password: "s3cret" },
    });

    const unauthed = await request(app).get("/api/commute");
    expect(unauthed.status).toBe(401);

    const authed = await request(app)
      .get("/api/commute")
      .set("Authorization", `Basic ${Buffer.from("alice:s3cret").toString("base64")}`);
    expect(authed.status).toBe(200);
  });
});

describe("GET /api/commute", () => {
  it("serves the commute config for the front-end", async () => {
    const app = createApp(fakeClient(search, { TAKEN: takenService }));

    const response = await request(app).get("/api/commute");

    expect(response.status).toBe(200);
    expect(response.body.fromCrs).toBe("BTN");
    expect(response.body.viaCrs).toBe("GTW");
    expect(response.body.toCrs).toBe("LBG");
    expect(response.body.outboundPresets).toEqual([
      { label: "06:39", time: "0639" },
      { label: "06:56", time: "0656" },
    ]);
  });
});

describe("POST /api/check-commute", () => {
  const throughService: RttServiceResponse = {
    serviceUid: "TAKEN",
    runDate: "2026-09-23",
    atocCode: "TL",
    atocName: "Thameslink",
    locations: [
      {
        crs: "BTN",
        description: "Brighton",
        gbttBookedDeparture: "0639",
        gbttBookedArrival: "0639",
        realtimeArrival: "0639",
        realtimeArrivalActual: true,
      },
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

  function commuteClient(): RttClient {
    return {
      searchStationToStation: vi.fn(async (fromCrs: string, toCrs: string) => ({
        location: { name: fromCrs, crs: fromCrs },
        services: [
          {
            serviceUid: "TAKEN",
            runDate: "2026-09-23",
            atocCode: "TL",
            atocName: "Thameslink",
            serviceType: "train",
            isPassenger: true,
            locationDetail: {
              gbttBookedDeparture: fromCrs === "GTW" ? "0707" : "0639",
              origin: [],
              destination: [],
            },
          },
        ],
      })),
      getService: vi.fn().mockResolvedValue(throughService),
    } as unknown as RttClient;
  }

  it("returns 400 for invalid input", async () => {
    const app = createApp(commuteClient());

    const response = await request(app).post("/api/check-commute").send({ direction: "sideways" });

    expect(response.status).toBe(400);
  });

  it("evaluates both legs of the outbound commute from a single time", async () => {
    const app = createApp(commuteClient());

    const response = await request(app)
      .post("/api/check-commute")
      .send({ direction: "outbound", date: "2026-09-23", time: "0639" });

    expect(response.status).toBe(200);
    expect(response.body.results).toHaveLength(2);
    expect(response.body.results[0].leg.fromCrs).toBe("BTN");
    expect(response.body.results[0].leg.toCrs).toBe("GTW");
    expect(response.body.results[1].leg.fromCrs).toBe("GTW");
    expect(response.body.results[1].leg.toCrs).toBe("LBG");
    expect(response.body.results[1].delayMinutes).toBe(30);
  });

  it("swaps stations for the return direction", async () => {
    const app = createApp(commuteClient());

    const response = await request(app)
      .post("/api/check-commute")
      .send({ direction: "return", date: "2026-09-23", time: "1810" });

    expect(response.status).toBe(200);
    expect(response.body.results[0].leg.fromCrs).toBe("LBG");
    expect(response.body.results[1].leg.toCrs).toBe("BTN");
  });
});
