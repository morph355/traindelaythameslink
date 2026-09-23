import { describe, expect, it, vi } from "vitest";
import type { AgentMailClient } from "agentmail";
import { downloadAttachment, listTicketEmails } from "../../src/tickets/agentmailClient.js";

function fakeAgentMailClient(overrides: {
  list?: ReturnType<typeof vi.fn>;
  getAttachment?: ReturnType<typeof vi.fn>;
}): AgentMailClient {
  return {
    inboxes: {
      messages: {
        list: overrides.list ?? vi.fn(),
        getAttachment: overrides.getAttachment ?? vi.fn(),
      },
    },
  } as unknown as AgentMailClient;
}

describe("listTicketEmails", () => {
  it("filters to messages that have a PDF attachment", async () => {
    const list = vi.fn().mockResolvedValue({
      count: 2,
      messages: [
        {
          messageId: "M1",
          from: "bookings@trainpal.com",
          subject: "Your e-ticket",
          timestamp: new Date("2026-09-20T10:00:00Z"),
          attachments: [{ attachmentId: "A1", filename: "ticket.pdf", contentType: "application/pdf", size: 100 }],
        },
        {
          messageId: "M2",
          from: "bookings@trainpal.com",
          subject: "Marketing newsletter",
          timestamp: new Date("2026-09-21T10:00:00Z"),
          attachments: [],
        },
      ],
    });
    const client = fakeAgentMailClient({ list });

    const results = await listTicketEmails(client, "thameslink-tickets@agentmail.to", ["trainpal"]);

    expect(list).toHaveBeenCalledWith("thameslink-tickets@agentmail.to", { from: ["trainpal"], limit: 25 });
    expect(results).toHaveLength(1);
    expect(results[0].messageId).toBe("M1");
    expect(results[0].pdfAttachments).toHaveLength(1);
  });

  it("recognises a PDF by filename when contentType is missing", async () => {
    const list = vi.fn().mockResolvedValue({
      count: 1,
      messages: [
        {
          messageId: "M1",
          from: "bookings@trainpal.com",
          timestamp: new Date(),
          attachments: [{ attachmentId: "A1", filename: "eticket.PDF", size: 100 }],
        },
      ],
    });
    const client = fakeAgentMailClient({ list });

    const results = await listTicketEmails(client, "inbox", ["trainpal"]);

    expect(results).toHaveLength(1);
  });
});

describe("downloadAttachment", () => {
  it("fetches the attachment's download URL and returns its bytes", async () => {
    const getAttachment = vi.fn().mockResolvedValue({
      attachmentId: "A1",
      size: 4,
      downloadUrl: "https://files.agentmail.to/a1",
      expiresAt: new Date(),
    });
    const client = fakeAgentMailClient({ getAttachment });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      arrayBuffer: async () => new TextEncoder().encode("data").buffer,
    });

    const buffer = await downloadAttachment(client, "inbox", "M1", "A1", fetchImpl as unknown as typeof fetch);

    expect(getAttachment).toHaveBeenCalledWith("inbox", "M1", "A1");
    expect(fetchImpl).toHaveBeenCalledWith("https://files.agentmail.to/a1");
    expect(buffer.toString()).toBe("data");
  });

  it("throws when the download fails", async () => {
    const getAttachment = vi.fn().mockResolvedValue({
      attachmentId: "A1",
      size: 4,
      downloadUrl: "https://files.agentmail.to/a1",
      expiresAt: new Date(),
    });
    const client = fakeAgentMailClient({ getAttachment });
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 403, statusText: "Forbidden" });

    await expect(
      downloadAttachment(client, "inbox", "M1", "A1", fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/403/);
  });
});
