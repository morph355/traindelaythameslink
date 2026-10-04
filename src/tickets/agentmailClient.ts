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

export interface RequestEmail {
  messageId: string;
  from: string;
  timestamp: Date;
  /** Ticket PDFs attached, if any - a forwarded TrainPal booking is a valid request too, not just plain text. */
  pdfAttachments: AgentMail.Attachment[];
}

/**
 * Recent messages in `inboxId` from a sender matching one of `fromFilters`
 * that aren't already labelled `excludeLabel` - candidate "check my
 * journey" requests, whether that's typed "out:/back:" text, a forwarded
 * TrainPal ticket, or both (as a real one turned out to be - someone
 * forwarding a booking naturally adds a note on top of it).
 */
export async function listUnprocessedRequestEmails(
  client: AgentMailClient,
  inboxId: string,
  fromFilters: string[],
  excludeLabel: string,
): Promise<RequestEmail[]> {
  const response = await client.inboxes.messages.list(inboxId, {
    from: fromFilters,
    limit: 25,
    ascending: true,
  });

  return response.messages
    .filter((m) => !(m.labels ?? []).includes(excludeLabel))
    .map((m) => ({
      messageId: m.messageId,
      from: m.from,
      timestamp: m.timestamp,
      pdfAttachments: (m.attachments ?? []).filter(isPdf),
    }));
}

/** Full plain-text body of a message. */
export async function getMessageText(
  client: AgentMailClient,
  inboxId: string,
  messageId: string,
): Promise<string> {
  const message = await client.inboxes.messages.get(inboxId, messageId);
  return message.text ?? message.extractedText ?? "";
}

/** Replies to a message (defaults to replying to its sender). */
export async function replyToMessage(
  client: AgentMailClient,
  inboxId: string,
  messageId: string,
  text: string,
): Promise<void> {
  await client.inboxes.messages.reply(inboxId, messageId, { text });
}

/** Adds a label to a message, e.g. to mark it handled so it isn't reprocessed. */
export async function addLabel(
  client: AgentMailClient,
  inboxId: string,
  messageId: string,
  label: string,
): Promise<void> {
  await client.inboxes.messages.update(inboxId, messageId, { addLabels: label });
}
