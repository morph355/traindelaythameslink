import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../src/server/app.js";
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

const takenService: RttServiceDetailResponse = {
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
          arrival: { scheduleAdvertised: "2026-09-23T08:10:00Z", realtimeActual: "2026-09-23T08:32:00Z", realtimeNoReport: false },
        },
      },
    ],
  },
};

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
    const app = createApp(fakeClient({ services: [] }, {}));

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
  const throughService: RttServiceDetailResponse = {
    service: {
      scheduleMetadata: {
        uniqueIdentity: "gb-nr:TAKEN:2026-09-23",
        namespace: "gb-nr",
        identity: "TAKEN",
        departureDate: "2026-09-23",
      },
      locations: [
        {
          location: { shortCodes: ["BTN"] },
          temporalData: {
            departure: { scheduleAdvertised: "2026-09-23T05:39:00Z" },
            arrival: { scheduleAdvertised: "2026-09-23T05:39:00Z", realtimeActual: "2026-09-23T05:39:00Z", realtimeNoReport: false },
          },
        },
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

  function commuteClient(): RttClient {
    return {
      searchStationToStation: vi.fn(async (fromCrs: string) => ({
        services: [
          {
            scheduleMetadata: {
              uniqueIdentity: "gb-nr:TAKEN:2026-09-23",
              namespace: "gb-nr",
              identity: "TAKEN",
              departureDate: "2026-09-23",
              inPassengerService: true,
            },
            temporalData: {
              departure: { scheduleAdvertised: fromCrs === "GTW" ? "2026-09-23T06:07:00Z" : "2026-09-23T05:39:00Z" },
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
