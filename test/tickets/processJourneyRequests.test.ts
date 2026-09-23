import { describe, expect, it, vi } from "vitest";
import type { AgentMailClient } from "agentmail";
import { NoMatchingServiceError } from "../../src/rtt/checkLeg.js";
import type { RttClient } from "../../src/rtt/client.js";
import type { RttSearchResponse, RttServiceResponse } from "../../src/rtt/types.js";
import { PROCESSED_LABEL, processJourneyRequests } from "../../src/tickets/processJourneyRequests.js";

const OWNER = "me@example.com";

function fakeAgentMail(messages: unknown[], bodies: Record<string, string>) {
  const reply = vi.fn().mockResolvedValue({});
  const update = vi.fn().mockResolvedValue({});
  const list = vi.fn().mockResolvedValue({ count: messages.length, messages });
  const get = vi.fn(async (_inboxId: string, messageId: string) => ({ text: bodies[messageId] ?? "" }));

  const client = {
    inboxes: { messages: { list, get, reply, update } },
  } as unknown as AgentMailClient;

  return { client, reply, update, list, get };
}

const throughService: RttServiceResponse = {
  serviceUid: "TAKEN",
  runDate: "2026-09-23",
  atocCode: "TL",
  atocName: "Thameslink",
  locations: [
    { crs: "BTN", description: "Brighton", gbttBookedDeparture: "0639", gbttBookedArrival: "0639", realtimeArrival: "0639", realtimeArrivalActual: true },
    { crs: "GTW", description: "Gatwick Airport", gbttBookedArrival: "0705", gbttBookedDeparture: "0707", realtimeArrival: "0719", realtimeArrivalActual: true },
    { crs: "LBG", description: "London Bridge", gbttBookedArrival: "0755", realtimeArrival: "0825", realtimeArrivalActual: true },
  ],
};

function fakeRtt(): RttClient {
  return {
    searchStationToStation: vi.fn(async (fromCrs: string) => ({
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
    })) as unknown as RttClient["searchStationToStation"],
    getService: vi.fn().mockResolvedValue(throughService),
  } as unknown as RttClient;
}

function fakeRttNoService(): RttClient {
  return {
    searchStationToStation: vi.fn().mockResolvedValue({ location: { name: "BTN", crs: "BTN" }, services: [] }),
    getService: vi.fn(),
  } as unknown as RttClient;
}

describe("processJourneyRequests", () => {
  it("replies with eligibility details and labels the message processed", async () => {
    const { client, reply, update } = fakeAgentMail(
      [{ messageId: "M1", from: OWNER, timestamp: new Date(2026, 8, 23), labels: [], attachments: [] }],
      { M1: "out: 06:39" },
    );
    const rtt = fakeRtt();

    const result = await processJourneyRequests({
      agentMail: client,
      rtt,
      inboxId: "inbox",
      ownerEmail: OWNER,
      appUrl: "https://example.com",
    });

    expect(result.processed).toBe(1);
    expect(reply).toHaveBeenCalledTimes(1);
    const [, messageId, { text }] = reply.mock.calls[0];
    expect(messageId).toBe("M1");
    expect(text).toContain("OUTBOUND");
    expect(text).toContain("Check another journey: https://example.com");
    expect(update).toHaveBeenCalledWith("inbox", "M1", { addLabels: PROCESSED_LABEL });
  });

  it("sends the format-help text when the body can't be parsed", async () => {
    const { client, reply, update } = fakeAgentMail(
      [{ messageId: "M1", from: OWNER, timestamp: new Date(), labels: [], attachments: [] }],
      { M1: "Hi, what happened to my train today?" },
    );

    await processJourneyRequests({ agentMail: client, rtt: fakeRtt(), inboxId: "inbox", ownerEmail: OWNER });

    const [, , { text }] = reply.mock.calls[0];
    expect(text).toMatch(/out: 06:39/);
    expect(update).toHaveBeenCalledWith("inbox", "M1", { addLabels: PROCESSED_LABEL });
  });

  it("replies with a not-found explanation and still marks processed when no service matches", async () => {
    const { client, reply, update } = fakeAgentMail(
      [{ messageId: "M1", from: OWNER, timestamp: new Date(), labels: [], attachments: [] }],
      { M1: "out: 06:39" },
    );

    await processJourneyRequests({ agentMail: client, rtt: fakeRttNoService(), inboxId: "inbox", ownerEmail: OWNER });

    const [, , { text }] = reply.mock.calls[0];
    expect(text).toMatch(/Couldn't find a matching service/);
    expect(update).toHaveBeenCalledWith("inbox", "M1", { addLabels: PROCESSED_LABEL });
  });

  it("does nothing when there are no unprocessed messages", async () => {
    const { client, reply } = fakeAgentMail([], {});

    const result = await processJourneyRequests({ agentMail: client, rtt: fakeRtt(), inboxId: "inbox", ownerEmail: OWNER });

    expect(result.processed).toBe(0);
    expect(reply).not.toHaveBeenCalled();
  });
});
