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
    expect(new URL(url).searchParams.get("timeFrom")).toBe("2026-09-23T06:39:00");
    expect(new URL(url).searchParams.get("timeWindow")).toBe("180");
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
});
