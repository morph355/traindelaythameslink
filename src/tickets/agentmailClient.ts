import { AgentMail, AgentMailClient } from "agentmail";

export function createAgentMailClient(apiKey: string): AgentMailClient {
  return new AgentMailClient({ apiKey });
}

export interface TicketEmail {
  messageId: string;
  from: string;
  subject?: string;
  timestamp: Date;
  pdfAttachments: AgentMail.Attachment[];
}

function isPdf(attachment: AgentMail.Attachment): boolean {
  return (
    attachment.contentType === "application/pdf" ||
    (attachment.filename?.toLowerCase().endsWith(".pdf") ?? false)
  );
}

/**
 * Recent messages in `inboxId` from a sender matching one of `fromFilters`
 * (substring match) that have a PDF attachment - candidate ticket emails.
 */
export async function listTicketEmails(
  client: AgentMailClient,
  inboxId: string,
  fromFilters: string[],
): Promise<TicketEmail[]> {
  const response = await client.inboxes.messages.list(inboxId, {
    from: fromFilters,
    limit: 25,
  });

  return response.messages
    .filter((m) => (m.attachments ?? []).some(isPdf))
    .map((m) => ({
      messageId: m.messageId,
      from: m.from,
      subject: m.subject,
      timestamp: m.timestamp,
      pdfAttachments: (m.attachments ?? []).filter(isPdf),
    }));
}

/** Downloads one attachment's raw bytes. */
export async function downloadAttachment(
  client: AgentMailClient,
  inboxId: string,
  messageId: string,
  attachmentId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Buffer> {
  const meta = await client.inboxes.messages.getAttachment(inboxId, messageId, attachmentId);
  const response = await fetchImpl(meta.downloadUrl);
  if (!response.ok) {
    throw new Error(`Failed to download attachment ${attachmentId}: ${response.status} ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}
