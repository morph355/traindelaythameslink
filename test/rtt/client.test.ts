import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { RttApiError, RttClient } from "../../src/rtt/client.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/**
 * A fetch mock that serves /api/get_access_token (the refresh -> access
 * token exchange every real request goes through first) and returns
 * `dataResponse` for everything else.
 */
function fetchMockWithAccessToken(accessToken: string, dataResponse: Response, validUntil = "2099-01-01T00:00:00Z") {
  return vi.fn(async (url: string) => {
    if (new URL(url).pathname === "/api/get_access_token") {
      return jsonResponse({ token: accessToken, validUntil });
    }
    return dataResponse;
  });
}

describe("RttClient", () => {
  it("exchanges the refresh token for an access token, then uses that as Bearer auth on the data request", async () => {
    const fetchMock = fetchMockWithAccessToken("access-tok-456", jsonResponse({ services: [] }));
    const client = new RttClient({ token: "refresh-tok-123" }, "https://data.rtt.io", fetchMock);

    await client.searchStationToStation("BTN", "GTW", new Date(2026, 8, 23), "0639");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
    expect(new URL(tokenUrl).pathname).toBe("/api/get_access_token");
    expect(tokenInit.headers.Authorization).toBe("Bearer refresh-tok-123");

    const [url, init] = fetchMock.mock.calls[1];
    expect(new URL(url).pathname).toBe("/gb-nr/location");
    expect(new URL(url).searchParams.get("code")).toBe("BTN");
    expect(new URL(url).searchParams.get("filterTo")).toBe("GTW");
    // Starts 10 minutes early (a search from the exact booked minute can miss that train), and runs 10 minutes longer.
    expect(new URL(url).searchParams.get("timeFrom")).toBe("2026-09-23T06:29:00");
    expect(new URL(url).searchParams.get("timeWindow")).toBe("190");
    expect(init.headers.Authorization).toBe("Bearer access-tok-456");
  });

  it("fetches service detail by identity and departure date", async () => {
    const fetchMock = fetchMockWithAccessToken("access-tok-456", jsonResponse({ service: { locations: [] } }));
    const client = new RttClient({ token: "refresh-tok-123" }, "https://data.rtt.io", fetchMock);

    await client.getService("L01525", new Date(2026, 8, 23));

    const [url] = fetchMock.mock.calls[1];
    expect(new URL(url).pathname).toBe("/gb-nr/service");
    expect(new URL(url).searchParams.get("identity")).toBe("L01525");
    expect(new URL(url).searchParams.get("departureDate")).toBe("2026-09-23");
  });

  it("reuses a cached access token across requests instead of re-exchanging every time", async () => {
    const fetchMock = fetchMockWithAccessToken("access-tok-456", jsonResponse({ services: [] }));
    const client = new RttClient({ token: "refresh-tok-123" }, "https://data.rtt.io", fetchMock);

    await client.searchStationToStation("BTN", "GTW", new Date(2026, 8, 23), "0639");
    await client.searchStationToStation("BTN", "GTW", new Date(2026, 8, 23), "0656");

    const tokenCalls = fetchMock.mock.calls.filter(([url]) => new URL(url).pathname === "/api/get_access_token");
    expect(tokenCalls).toHaveLength(1);
  });

  it("re-exchanges once the cached access token has expired", async () => {
    const fetchMock = fetchMockWithAccessToken(
      "access-tok-456",
      jsonResponse({ services: [] }),
      "1970-01-01T00:00:00Z",
    );
    const client = new RttClient({ token: "refresh-tok-123" }, "https://data.rtt.io", fetchMock);

    await client.searchStationToStation("BTN", "GTW", new Date(2026, 8, 23), "0639");
    await client.searchStationToStation("BTN", "GTW", new Date(2026, 8, 23), "0656");

    const tokenCalls = fetchMock.mock.calls.filter(([url]) => new URL(url).pathname === "/api/get_access_token");
    expect(tokenCalls).toHaveLength(2);
  });

  it("throws RttApiError when the access-token exchange itself fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: "Invalid refresh token" }, false, 401));
    const client = new RttClient({ token: "bad-token" }, "https://data.rtt.io", fetchMock);

    await expect(client.searchStationToStation("BTN", "GTW", new Date(2026, 8, 23), "0639")).rejects.toThrow(
      RttApiError,
    );
  });

  it("throws RttApiError on a non-ok response from the data endpoint", async () => {
    const fetchMock = fetchMockWithAccessToken("access-tok-456", jsonResponse({}, false, 401));
    const client = new RttClient({ token: "refresh-tok-123" }, "https://data.rtt.io", fetchMock);

    await expect(client.searchStationToStation("BTN", "GTW", new Date(2026, 8, 23), "0639")).rejects.toThrow(
      RttApiError,
    );
  });

  it("includes the response body in the error, so e.g. a 401's actual reason isn't lost", async () => {
    const fetchMock = fetchMockWithAccessToken(
      "access-tok-456",
      jsonResponse({ message: "No active subscription for gb-nr" }, false, 401),
    );
    const client = new RttClient({ token: "refresh-tok-123" }, "https://data.rtt.io", fetchMock);

    await expect(client.searchStationToStation("BTN", "GTW", new Date(2026, 8, 23), "0639")).rejects.toThrow(
      /No active subscription for gb-nr/,
    );
  });

  it("waits out Retry-After on a 429 and retries the data request", async () => {
    let dataCalls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (new URL(url).pathname === "/api/get_access_token") {
        return jsonResponse({ token: "a", validUntil: "2099-01-01T00:00:00Z" });
      }
      dataCalls++;
      if (dataCalls === 1) {
        return { ...jsonResponse({ error: "Rate limit exceeded" }, false, 429), headers: new Headers({ "retry-after": "2" }) } as unknown as Response;
      }
      return jsonResponse({ services: [] });
    });
    const sleep = vi.fn(async () => {});
    const client = new RttClient({ token: "t" }, "https://data.rtt.io", fetchMock, sleep);

    await client.searchStationToStation("BTN", "GTW", new Date(2026, 8, 23), "0639");

    expect(sleep).toHaveBeenCalledWith(2500);
    expect(dataCalls).toBe(2);
  });

  it("spaces requests so no more than 9 go out per minute", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = fetchMockWithAccessToken("a", jsonResponse({ services: [] }));
      const client = new RttClient({ token: "t" }, "https://data.rtt.io", fetchMock);
      const dataCalls = () => fetchMock.mock.calls.filter(([u]) => new URL(u).pathname !== "/api/get_access_token").length;

      const all = Promise.all(
        Array.from({ length: 10 }, () => client.searchStationToStation("BTN", "GTW", new Date(2026, 8, 23), "0639")),
      );
      await vi.advanceTimersByTimeAsync(1000);
      expect(dataCalls()).toBe(9);
      await vi.advanceTimersByTimeAsync(60_000);
      await all;
      expect(dataCalls()).toBe(10);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports recent activity and RTT's rate-limit headers via getStatus", async () => {
    const data = {
      ...jsonResponse({ services: [] }),
      headers: new Headers({ "x-ratelimit-remaining-minute": "7", "x-ratelimit-remaining-hour": "90", "x-ratelimit-remaining-day": "990" }),
    } as unknown as Response;
    const client = new RttClient({ token: "t" }, "https://data.rtt.io", fetchMockWithAccessToken("a", data));

    await client.searchStationToStation("BTN", "GTW", new Date(2026, 8, 23), "0639");

    const status = client.getStatus();
    expect(status.requestsLastMinute).toBe(1);
    expect(status.rateLimitRemaining).toEqual({ minute: 7, hour: 90, day: 990 });
    expect(status.recent.map((e) => e.message)).toContain("/gb-nr/location BTN -> 200");
    expect(JSON.stringify(status)).not.toContain("Bearer");
  });

  it("does not wait when RTT says the limit resets in more than a minute", async () => {
    const limited = {
      ...jsonResponse({ error: "Rate limit exceeded" }, false, 429),
      headers: new Headers({ "retry-after": "1800" }),
    } as unknown as Response;
    const sleep = vi.fn(async () => {});
    const client = new RttClient({ token: "t" }, "https://data.rtt.io", fetchMockWithAccessToken("a", limited), sleep);

    await expect(client.searchStationToStation("BTN", "GTW", new Date(2026, 8, 23), "0639")).rejects.toMatchObject({
      status: 429,
    });
    expect(sleep).not.toHaveBeenCalled();
    expect(client.getStatus().recent.at(-1)?.message).toContain("resets in about 30 min");
  });

  describe("response cache", () => {
    const dataCalls = (fetchMock: ReturnType<typeof fetchMockWithAccessToken>) =>
      fetchMock.mock.calls.filter(([u]) => new URL(u).pathname !== "/api/get_access_token").length;

    it("serves a repeat request for a past date from cache, without another RTT call", async () => {
      const fetchMock = fetchMockWithAccessToken("a", jsonResponse({ services: [] }));
      const client = new RttClient({ token: "t" }, "https://data.rtt.io", fetchMock);

      await client.searchStationToStation("BTN", "GTW", new Date(2026, 8, 23), "0639");
      await client.searchStationToStation("BTN", "GTW", new Date(2026, 8, 23), "0639");
      await client.searchStationToStation("BTN", "GTW", new Date(2026, 8, 23), "0656");

      expect(dataCalls(fetchMock)).toBe(2); // 0639 once, 0656 once
    });

    it("keeps past-date responses for a day, but today's for only an hour", async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date(2026, 9, 4, 12, 0));
        const fetchMock = fetchMockWithAccessToken("a", jsonResponse({ services: [] }), "2099-01-01T00:00:00Z");
        const client = new RttClient({ token: "t" }, "https://data.rtt.io", fetchMock);
        const past = new Date(2026, 9, 3);
        const today = new Date(2026, 9, 4);

        await client.searchStationToStation("BTN", "GTW", past, "0639");
        await client.searchStationToStation("BTN", "GTW", today, "0639");
        vi.setSystemTime(new Date(2026, 9, 4, 12, 30));
        await client.searchStationToStation("BTN", "GTW", past, "0639");
        await client.searchStationToStation("BTN", "GTW", today, "0639");
        expect(dataCalls(fetchMock)).toBe(2); // both still cached after 30 min

        vi.setSystemTime(new Date(2026, 9, 4, 13, 30));
        await client.searchStationToStation("BTN", "GTW", past, "0639");
        await client.searchStationToStation("BTN", "GTW", today, "0639");
        expect(dataCalls(fetchMock)).toBe(3); // today's expired, past still cached

        vi.setSystemTime(new Date(2026, 9, 5, 13, 0));
        await client.searchStationToStation("BTN", "GTW", past, "0639");
        expect(dataCalls(fetchMock)).toBe(4); // past expired after a day
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not cache failed responses", async () => {
      const fetchMock = fetchMockWithAccessToken("a", jsonResponse({ error: "boom" }, false, 500));
      const client = new RttClient({ token: "t" }, "https://data.rtt.io", fetchMock);
      await expect(client.searchStationToStation("BTN", "GTW", new Date(2026, 8, 23), "0639")).rejects.toBeInstanceOf(RttApiError);
      await expect(client.searchStationToStation("BTN", "GTW", new Date(2026, 8, 23), "0639")).rejects.toBeInstanceOf(RttApiError);
      expect(dataCalls(fetchMock)).toBe(2);
    });

    it("persists the cache to a file so a restarted client reuses it", async () => {
      const dir = mkdtempSync(path.join(tmpdir(), "rtt-cache-"));
      const cacheFile = path.join(dir, "nested", "cache.json");
      try {
        const first = fetchMockWithAccessToken("a", jsonResponse({ services: [] }));
        await new RttClient({ token: "t" }, "https://data.rtt.io", first, undefined, { cacheFile }).searchStationToStation(
          "BTN", "GTW", new Date(2026, 8, 23), "0639");

        const second = fetchMockWithAccessToken("a", jsonResponse({ services: [] }));
        const restarted = new RttClient({ token: "t" }, "https://data.rtt.io", second, undefined, { cacheFile });
        await restarted.searchStationToStation("BTN", "GTW", new Date(2026, 8, 23), "0639");

        expect(dataCalls(second)).toBe(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  it("starts the search before the booked time so a train departing exactly then is not missed", async () => {
    const fetchMock = fetchMockWithAccessToken("a", jsonResponse({ services: [] }));
    const client = new RttClient({ token: "t" }, "https://data.rtt.io", fetchMock);
    const fromOf = async (time: string) => {
      fetchMock.mockClear();
      await client.searchStationToStation("BTN", "LBG", new Date(2026, 8, 23, 12), time);
      const dataCall = fetchMock.mock.calls.find(([u]) => new URL(u).pathname === "/gb-nr/location")!;
      return new URL(dataCall[0]).searchParams.get("timeFrom");
    };

    expect(await fromOf("0656")).toBe("2026-09-23T06:46:00");
    expect(await fromOf("0700")).toBe("2026-09-23T06:50:00");
    expect(await fromOf("0005")).toBe("2026-09-23T00:00:00"); // floored, stays on the same date
  });
});
