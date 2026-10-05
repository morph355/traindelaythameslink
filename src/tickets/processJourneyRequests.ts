import type { AgentMailClient } from "agentmail";
import { buildCommuteJourneySpec, type CommuteDirection } from "../config/commute.js";
import { NoMatchingServiceError } from "../rtt/checkLeg.js";
import { checkSplitJourney } from "../rtt/checkSplitJourney.js";
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
import { composeReplyText, type DirectionResult, type TicketsByLeg } from "./replyComposer.js";
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
  try {
    if (request.outboundTime) {
      results.push(await checkDirection(rtt, "outbound", request.date, request.outboundTime, request.outboundTook));
    }
    if (request.returnTime) {
      results.push(await checkDirection(rtt, "return", request.date, request.returnTime, request.returnTook));
    }
  } catch (err) {
    if (err instanceof NoMatchingServiceError) {
      await replyToMessage(
        agentMail,
        inboxId,
        messageId,
        `Couldn't find a matching service: ${err.message}\n\nDouble-check the time and try again.`,
      );
      await addLabel(agentMail, inboxId, messageId, PROCESSED_LABEL);
      return;
    }
    throw err;
  }

  const tickets = await loadTickets(options, messageId, pdfAttachments, receivedAt.getFullYear());
  const replyText = composeReplyText(results, appUrl, tickets);
  await replyToMessage(agentMail, inboxId, messageId, replyText);
  await addLabel(agentMail, inboxId, messageId, PROCESSED_LABEL);
}

async function checkDirection(
  rtt: RttClient,
  direction: CommuteDirection,
  date: Date,
  time: string,
  took?: string,
): Promise<DirectionResult> {
  const spec = buildCommuteJourneySpec(direction, date, time, took);
  const legs = await checkSplitJourney(rtt, spec);
  return { direction, legs };
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
