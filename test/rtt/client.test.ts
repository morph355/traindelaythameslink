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
  it("builds the search URL with date and time segments and sends basic auth", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ location: {}, services: [] }));
    const client = new RttClient(
      { username: "user", password: "pass" },
      "https://api.rtt.io/api/v1",
      fetchMock,
    );

    await client.searchStationToStation("STP", "BTN", new Date(2026, 8, 23), "0812");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.rtt.io/api/v1/json/search/STP/to/BTN/2026/09/23/0812",
      { headers: { Authorization: `Basic ${Buffer.from("user:pass").toString("base64")}` } },
    );
  });

  it("omits the time segment when no time is given", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ location: {}, services: [] }));
    const client = new RttClient({ username: "u", password: "p" }, "https://api.rtt.io/api/v1", fetchMock);

    await client.searchStationToStation("STP", "BTN", new Date(2026, 8, 23));

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.rtt.io/api/v1/json/search/STP/to/BTN/2026/09/23",
      expect.anything(),
    );
  });

  it("fetches service detail by uid and date", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ serviceUid: "G12345", locations: [] }));
    const client = new RttClient({ username: "u", password: "p" }, "https://api.rtt.io/api/v1", fetchMock);

    const result = await client.getService("G12345", new Date(2026, 8, 23));

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.rtt.io/api/v1/json/service/G12345/2026/09/23",
      expect.anything(),
    );
    expect(result.serviceUid).toBe("G12345");
  });

  it("throws RttApiError on a non-ok response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, false, 401));
    const client = new RttClient({ username: "u", password: "p" }, "https://api.rtt.io/api/v1", fetchMock);

    await expect(client.searchStationToStation("STP", "BTN", new Date(2026, 8, 23))).rejects.toThrow(RttApiError);
  });
});
