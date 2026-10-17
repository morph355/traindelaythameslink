import type { AgentMailClient } from "agentmail";
import { checkCommuteDirection, type DirectionOutcome, type DirectionResult } from "../commute/checkCommuteDirection.js";
import type { RttClient } from "../rtt/client.js";
import {
  addLabel,
  downloadAttachment,
  getMessageText,
  listUnprocessedRequestEmails,
  replyToMessage,
  type RequestEmail,
} from "./agentmailClient.js";
import { FORMAT_HELP, JourneyRequestParseError, parseJourneyRequest } from "./journeyRequest.js";
import { composeReplyText, type TicketsByLeg } from "./replyComposer.js";
import { extractPdfText } from "./pdfText.js";
import { parseTicketText } from "./ticketDetails.js";
import { findCommuteTimesFromAttachments, parseTicketFilename } from "./trainpal.js";

export const PROCESSED_LABEL = "checked";

export interface ProcessJourneyRequestsOptions {
  agentMail: AgentMailClient;
  rtt: RttClient;
  inboxId: string;
  /** Only emails from this address are treated as journey-check requests. */
  ownerEmail: string;
  /** Included as a link in the reply, if set. */
  appUrl?: string;
}

/**
 * Checks the inbox once for new request emails from the owner and replies
 * to each - whether that's typed "out:/back:" text, a forwarded TrainPal
 * ticket, or both.
 */
export async function processJourneyRequests(options: ProcessJourneyRequestsOptions): Promise<{ processed: number }> {
  const { agentMail, inboxId, ownerEmail } = options;

  const candidates = await listUnprocessedRequestEmails(agentMail, inboxId, [ownerEmail], PROCESSED_LABEL);

  for (const candidate of candidates) {
    await handleOne(options, candidate);
  }

  return { processed: candidates.length };
}

interface ResolvedRequest {
  date: Date;
  outboundTime?: string;
  returnTime?: string;
  outboundTook?: string;
  returnTook?: string;
  /** One direct ticket for that direction (typed "direct", or a whole-journey ticket in the attachments). */
  outboundDirect?: boolean;
  returnDirect?: boolean;
}

export function resolveRequest(body: string, receivedAt: Date, pdfFilenames: string[]): ResolvedRequest | undefined {
  let textRequest;
  try {
    textRequest = parseJourneyRequest(body, receivedAt);
  } catch (err) {
    if (!(err instanceof JourneyRequestParseError)) throw err;
    textRequest = undefined;
  }

  const pdfTimes =
    pdfFilenames.length > 0 ? findCommuteTimesFromAttachments(pdfFilenames, receivedAt.getFullYear()) : undefined;

  const outboundTime = textRequest?.outboundTime ?? pdfTimes?.outboundTime;
  const returnTime = textRequest?.returnTime ?? pdfTimes?.returnTime;
  if (!outboundTime && !returnTime) return undefined;

  // An explicit "date:" line wins; then the date on the forwarded booking's PDFs
  // (a forwarded old booking must not be checked against the day it was sent);
  // finally the day the email was sent.
  const date = textRequest?.dateSpecified
    ? textRequest.date
    : pdfTimes?.date
      ? parseIsoDate(pdfTimes.date)
      : (textRequest?.date ?? startOfDay(receivedAt));
  return {
    date,
    outboundTime,
    returnTime,
    ...(textRequest?.outboundTook && { outboundTook: textRequest.outboundTook }),
    ...(textRequest?.returnTook && { returnTook: textRequest.returnTook }),
    ...((textRequest?.outboundDirect || pdfTimes?.outboundDirect) && { outboundDirect: true }),
    ...((textRequest?.returnDirect || pdfTimes?.returnDirect) && { returnDirect: true }),
  };
}

/** yyyy-mm-dd as a local-midnight Date (not UTC, so server timezone can't shift the day). */
function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

async function handleOne(options: ProcessJourneyRequestsOptions, candidate: RequestEmail): Promise<void> {
  const { agentMail, rtt, inboxId, appUrl } = options;
  const { messageId, timestamp: receivedAt, pdfAttachments } = candidate;

  const body = await getMessageText(agentMail, inboxId, messageId);
  const pdfFilenames = pdfAttachments.map((a) => a.filename).filter((f): f is string => Boolean(f));

  const request = resolveRequest(body, receivedAt, pdfFilenames);
  if (!request) {
    await replyToMessage(agentMail, inboxId, messageId, FORMAT_HELP);
    await addLabel(agentMail, inboxId, messageId, PROCESSED_LABEL);
    return;
  }

  const results: DirectionResult[] = [];
  const directions = [
    { direction: "outbound", time: request.outboundTime, took: request.outboundTook, direct: request.outboundDirect },
    { direction: "return", time: request.returnTime, took: request.returnTook, direct: request.returnDirect },
  ] as const;
  for (const { time, ...rest } of directions) {
    if (!time) continue;
    // "took" only describes replacing a booked train partway through a split pair, so a direct ticket ignores it.
    const outcome = await checkCommuteDirection(rtt, {
      ...rest,
      date: request.date,
      time,
      took: rest.direct ? undefined : rest.took,
    });
    // noMatch / rejected can never succeed on a retry, so reply and mark handled rather than
    // looping every poll; a transient RTT failure throws out of here and is retried next tick.
    if (outcome.kind !== "ok") {
      await replyToMessage(agentMail, inboxId, messageId, describeFailure(outcome, request.date));
      await addLabel(agentMail, inboxId, messageId, PROCESSED_LABEL);
      return;
    }
    results.push(outcome.result);
  }

  const tickets = await loadTickets(options, messageId, pdfAttachments, receivedAt.getFullYear());
  const replyText = composeReplyText(results, appUrl, tickets);
  await replyToMessage(agentMail, inboxId, messageId, replyText);
  await addLabel(agentMail, inboxId, messageId, PROCESSED_LABEL);
}

/**
 * Ticket number/type/price for each leg, read from the attached PDFs. The leg
 * a PDF belongs to comes from its filename (reliable station names); the
 * details from its text. Best-effort: a PDF that can't be downloaded or read
 * is skipped with a warning rather than blocking the reply.
 */
async function loadTickets(
  options: ProcessJourneyRequestsOptions,
  messageId: string,
  attachments: RequestEmail["pdfAttachments"],
  yearHint: number,
): Promise<TicketsByLeg> {
  const tickets: TicketsByLeg = {};
  for (const attachment of attachments) {
    const leg = attachment.filename ? parseTicketFilename(attachment.filename, yearHint) : null;
    if (!leg?.fromCrs || !leg.toCrs) continue; // e.g. the E-receipt
    try {
      const pdf = await downloadAttachment(options.agentMail, options.inboxId, messageId, attachment.attachmentId);
      const details = parseTicketText(await extractPdfText(pdf));
      if (details) tickets[`${leg.fromCrs}-${leg.toCrs}`] = details;
    } catch (err) {
      console.warn(`Couldn't read ticket details from ${attachment.filename}:`, err instanceof Error ? err.message : err);
    }
  }
  return tickets;
}

function describeFailure(outcome: Exclude<DirectionOutcome, { kind: "ok" }>, date: Date): string {
  if (outcome.kind === "noMatch") {
    return `Couldn't find a matching service: ${outcome.message}\n\nDouble-check the time and try again.`;
  }
  if (outcome.reason === "historyLimit") {
    return (
      `Realtime Trains only provides about two weeks of journey history on this account, so ${date.toDateString()} ` +
      "is too old to check here. For a journey that old you'll need your own records (the ticket and your actual arrival time)."
    );
  }
  return `Realtime Trains rejected this request and it can't be retried: ${outcome.message}`;
}
