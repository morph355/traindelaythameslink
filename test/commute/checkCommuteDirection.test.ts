import { describe, expect, it, vi } from "vitest";
import { checkCommuteDirection } from "../../src/commute/checkCommuteDirection.js";
import { RttApiError, type RttClient } from "../../src/rtt/client.js";

const date = new Date(2026, 8, 1);

function clientRejecting(error: Error): RttClient {
  return { searchStationToStation: vi.fn().mockRejectedValue(error), getService: vi.fn() } as unknown as RttClient;
}

describe("checkCommuteDirection", () => {
  it("reports noMatch when no service matches the booked time", async () => {
    const client = { searchStationToStation: vi.fn().mockResolvedValue({ services: [] }), getService: vi.fn() } as unknown as RttClient;

    const outcome = await checkCommuteDirection(client, { direction: "outbound", date, time: "0656" });

    expect(outcome.kind).toBe("noMatch");
    if (outcome.kind === "noMatch") expect(outcome.message).toContain("BTN to LBG");
  });

  it("reports a historyLimit rejection when RTT refuses a date outside its history", async () => {
    const client = clientRejecting(
      new RttApiError('failed: 400 - {"error":"you are requesting a time period outside your permitted history"}', 400),
    );

    const outcome = await checkCommuteDirection(client, { direction: "outbound", date, time: "0656" });

    expect(outcome).toMatchObject({ kind: "rejected", reason: "historyLimit" });
  });

  it("reports any other 400 as an 'other' rejection", async () => {
    const outcome = await checkCommuteDirection(clientRejecting(new RttApiError("failed: 400 - bad", 400)), {
      direction: "return",
      date,
      time: "1812",
    });

    expect(outcome).toMatchObject({ kind: "rejected", reason: "other" });
  });

  it("still throws for transient RTT errors so callers can retry", async () => {
    await expect(
      checkCommuteDirection(clientRejecting(new RttApiError("failed: 503", 503)), { direction: "outbound", date, time: "0656" }),
    ).rejects.toThrow(/503/);
  });

  it("checks a direct ticket as one journey from one end of the commute to the other", async () => {
    const search = vi.fn().mockResolvedValue({ services: [] });
    const client = { searchStationToStation: search, getService: vi.fn() } as unknown as RttClient;

    await checkCommuteDirection(client, { direction: "return", date, time: "1812", direct: true });

    expect(search).toHaveBeenCalledWith("LBG", "BTN", date, "1812");
  });
});
