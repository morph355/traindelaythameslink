import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentMailClient } from "agentmail";
import { RttApiError, type RttClient } from "../../src/rtt/client.js";
import type { RttServiceDetailResponse } from "../../src/rtt/types.js";
import { processJourneyRequests } from "../../src/tickets/processJourneyRequests.js";

// Stand-in for real PDF text extraction: the text depends on which "PDF" is asked for.
const PDF_TEXT: Record<string, string> = {
  "ticket-a": "TICKET TYPE ROUTE\nAnytime Day Return Thameslink Only\nTicket Number CPB0TEST001\nPrice £ 15.90",
  "ticket-b": "TICKET TYPE ROUTE\nAnytime Return Not Underground\nTicket Number CPB0TEST002\nPrice £ 26.90",
  "ticket-direct": "TICKET TYPE ROUTE\nOff-Peak Day Return Thameslink Only\nTicket Number CPB0TEST003\nPrice £ 19.40",
};
vi.mock("../../src/tickets/pdfText.js", () => ({
  extractPdfText: async (buf: Buffer) => PDF_TEXT[buf.toString()] ?? "Expense Receipt\nTotal: £42.80",
}));

const OWNER = "me@example.com";
const D = "2026-09-23";
const t = (hhmm: string) => `${D}T${hhmm}:00`;

// BTN 06:56 -> GTW 07:35 (due; actually 07:50) -> LBG 08:05 (due; actually 08:39). Offset-less, as RTT sends.
const through: RttServiceDetailResponse = {
  service: {
    scheduleMetadata: { uniqueIdentity: `gb-nr:W45606:${D}`, namespace: "gb-nr", identity: "W45606", departureDate: D },
    reasons: [{ type: "DELAY", shortText: "signalling problem", longText: "a fault with the signalling system" }],
    locations: [
      { location: { shortCodes: ["BTN"] }, temporalData: { departure: { scheduleAdvertised: t("06:56"), realtimeActual: t("06:56") } } },
      {
        location: { shortCodes: ["GTW"] },
        temporalData: {
          arrival: { scheduleAdvertised: t("07:35"), realtimeActual: t("07:50") },
          departure: { scheduleAdvertised: t("07:36"), realtimeActual: t("07:51") },
        },
      },
      { location: { shortCodes: ["LBG"] }, temporalData: { arrival: { scheduleAdvertised: t("08:05"), realtimeActual: t("08:39") } } },
    ],
  },
};

function fakeRtt(): RttClient {
  const item = (dep: string) => ({
    scheduleMetadata: { uniqueIdentity: `gb-nr:W45606:${D}`, namespace: "gb-nr", identity: "W45606", departureDate: D, inPassengerService: true },
    temporalData: { departure: { scheduleAdvertised: t(dep) } },
  });
  return {
    searchStationToStation: vi.fn(async (from: string) => ({ services: [item(from === "GTW" ? "07:36" : "06:56")] })),
    getService: vi.fn().mockResolvedValue(through),
  } as unknown as RttClient;
}

type Attachment = { attachmentId: string; filename: string; contentType: string };

function fakeAgentMail(attachmentIds: Record<string, string>, override?: { attachments: Attachment[]; body: string }) {
  const reply = vi.fn().mockResolvedValue({});
  const messages = [
    {
      messageId: "M1",
      from: OWNER,
      timestamp: new Date(2026, 9, 4, 15, 45),
      labels: [],
      attachments: override?.attachments ?? [
        { attachmentId: "e-receipt", filename: "E-receipt.pdf", contentType: "application/pdf" },
        { attachmentId: "ticket-a", filename: "passenger_Brighton_to_Gatwick Airport_23_Sep_0656.pdf", contentType: "application/pdf" },
        { attachmentId: "ticket-b", filename: "passenger_Gatwick Airport_to_London Bridge_23_Sep_0736.pdf", contentType: "application/pdf" },
        { attachmentId: "broken", filename: "passenger_London Bridge_to_Gatwick Airport.pdf", contentType: "application/pdf" },
        ...Object.keys(attachmentIds).map((id) => ({ attachmentId: id, filename: `${id}.pdf`, contentType: "application/pdf" })),
      ],
    },
  ];
  const client = {
    inboxes: {
      messages: {
        list: vi.fn().mockResolvedValue({ count: 1, messages }),
        get: vi.fn().mockResolvedValue({ text: override?.body ?? "out: 06:56" }),
        getAttachment: vi.fn(async (_i: string, _m: string, attachmentId: string) => ({
          downloadUrl: `https://files.example/${attachmentId}`,
        })),
        reply,
        update: vi.fn().mockResolvedValue({}),
      },
    },
  } as unknown as AgentMailClient;
  return { client, reply };
}

afterEach(() => vi.unstubAllGlobals());

describe("processJourneyRequests with ticket PDFs", () => {
  it("puts each leg's ticket number, type, full price and the RTT reason in the reply", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const id = String(url).split("/").pop()!;
        if (id === "broken") return { ok: false, status: 500, statusText: "boom" };
        return { ok: true, arrayBuffer: async () => new TextEncoder().encode(id).buffer };
      }),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client, reply } = fakeAgentMail({});

    await processJourneyRequests({ agentMail: client, rtt: fakeRtt(), inboxId: "inbox", ownerEmail: OWNER });

    const [, , { text }] = reply.mock.calls[0];
    expect(text).toContain("Date: Wed 23 Sep 2026");
    expect(text).toContain("Scheduled departure: 07:36   Actual departure: 07:51");
    expect(text).toContain("Scheduled arrival: 08:05   Actual arrival: 08:39 - 34 min late");
    expect(text).toContain("Ticket: Anytime Day Return (Thameslink Only), ticket number CPB0TEST001, price £15.90");
    expect(text).toContain("Ticket: Anytime Return (Not Underground), ticket number CPB0TEST002, price £26.90");
    expect(text).toContain("Reason for delay: signalling problem - a fault with the signalling system");
    expect(text).not.toContain("52401949552"); // no order number
  });

  it("checks a direct ticket as one leg, with that ticket's details, instead of the split-save pair", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const id = String(url).split("/").pop()!;
        return { ok: true, arrayBuffer: async () => new TextEncoder().encode(id).buffer };
      }),
    );
    const pdf = (attachmentId: string, filename: string): Attachment => ({ attachmentId, filename, contentType: "application/pdf" });
    const { client, reply } = fakeAgentMail(
      {},
      {
        body: "out: 06:56",
        attachments: [
          pdf("e-receipt", "E-receipt.pdf"),
          pdf("ticket-direct", "passenger_Brighton_to_London Bridge_23_Sep_0656.pdf"),
          pdf("ticket-direct", "passenger_London Bridge_to_Brighton.pdf"),
        ],
      },
    );

    await processJourneyRequests({ agentMail: client, rtt: fakeRtt(), inboxId: "inbox", ownerEmail: OWNER });

    const [, , { text }] = reply.mock.calls[0];
    expect(text).toContain("BTN -> LBG (Brighton to London Bridge (direct ticket))");
    expect(text).not.toContain("BTN -> GTW");
    expect(text).not.toContain("GTW -> LBG");
    expect(text).toContain("Ticket: Off-Peak Day Return (Thameslink Only), ticket number CPB0TEST003, price £19.40");
    // The through train reached London Bridge 34 min late in this fixture.
    expect(text).toContain("Scheduled arrival: 08:05   Actual arrival: 08:39 - 34 min late");
  });

  it("uses a typed 'direct' line even with no direct ticket attached", async () => {
    const { client, reply } = fakeAgentMail({}, { body: "out: 06:56\ndirect", attachments: [] });

    await processJourneyRequests({ agentMail: client, rtt: fakeRtt(), inboxId: "inbox", ownerEmail: OWNER });

    const [, , { text }] = reply.mock.calls[0];
    expect(text).toContain("BTN -> LBG");
    expect(text).not.toContain("BTN -> GTW");
    expect(text).toContain("Ticket: not found in the attached PDFs");
  });

  it("replies and marks the email handled when RTT refuses a date outside its history, instead of retrying forever", async () => {
    const { client, reply } = fakeAgentMail({}, { body: "out: 06:56\ndate: 2026-09-01", attachments: [] });
    const rtt = {
      searchStationToStation: vi.fn().mockRejectedValue(
        new RttApiError('RTT API request to /gb-nr/location failed: 400 - {"error":"you are requesting a time period outside your permitted history"}', 400),
      ),
      getService: vi.fn(),
    } as unknown as RttClient;

    const result = await processJourneyRequests({ agentMail: client, rtt, inboxId: "inbox", ownerEmail: OWNER });

    expect(result.processed).toBe(1);
    const [, , { text }] = reply.mock.calls[0];
    expect(text).toContain("only provides about two weeks of journey history");
    expect(text).toContain("Tue Sep 01 2026");
  });

  it("still throws (to be retried later) for a server-side RTT error", async () => {
    const { client, reply } = fakeAgentMail({}, { body: "out: 06:56", attachments: [] });
    const rtt = {
      searchStationToStation: vi.fn().mockRejectedValue(new RttApiError("RTT API request failed: 503", 503)),
      getService: vi.fn(),
    } as unknown as RttClient;

    await expect(processJourneyRequests({ agentMail: client, rtt, inboxId: "inbox", ownerEmail: OWNER })).rejects.toThrow(/503/);
    expect(reply).not.toHaveBeenCalled();
  });
});

