import { describe, expect, it, vi } from "vitest";
import { RttApiError, RttClient } from "../../src/rtt/client.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: async () => body,
  } as unknown as Response;
}

describe("RttClient", () => {
  it("builds the location search URL with Bearer auth and query params", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ services: [] }));
    const client = new RttClient({ token: "tok123" }, "https://data.rtt.io", fetchMock);

    await client.searchStationToStation("BTN", "GTW", new Date(2026, 8, 23), "0639");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(url).pathname).toBe("/gb-nr/location");
    expect(new URL(url).searchParams.get("code")).toBe("BTN");
    expect(new URL(url).searchParams.get("filterTo")).toBe("GTW");
    expect(new URL(url).searchParams.get("timeFrom")).toBe("2026-09-23T06:39:00");
    expect(new URL(url).searchParams.get("timeWindow")).toBe("180");
    expect(init.headers.Authorization).toBe("Bearer tok123");
  });

  it("fetches service detail by identity and departure date", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ service: { locations: [] } }));
    const client = new RttClient({ token: "tok123" }, "https://data.rtt.io", fetchMock);

    await client.getService("L01525", new Date(2026, 8, 23));

    const [url] = fetchMock.mock.calls[0];
    expect(new URL(url).pathname).toBe("/gb-nr/service");
    expect(new URL(url).searchParams.get("identity")).toBe("L01525");
    expect(new URL(url).searchParams.get("departureDate")).toBe("2026-09-23");
  });

  it("throws RttApiError on a non-ok response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, false, 401));
    const client = new RttClient({ token: "tok123" }, "https://data.rtt.io", fetchMock);

    await expect(client.searchStationToStation("BTN", "GTW", new Date(2026, 8, 23), "0639")).rejects.toThrow(
      RttApiError,
    );
  });
});
