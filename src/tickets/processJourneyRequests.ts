import type { AgentMailClient } from "agentmail";
import { buildCommuteJourneySpec, type CommuteDirection } from "../config/commute.js";
import { NoMatchingServiceError } from "../rtt/checkLeg.js";
import { checkSplitJourney } from "../rtt/checkSplitJourney.js";
import type { RttClient } from "../rtt/client.js";
import {
  addLabel,
  getMessageText,
  listUnprocessedRequestEmails,
  replyToMessage,
  type RequestEmail,
} from "./agentmailClient.js";
import { FORMAT_HELP, JourneyRequestParseError, parseJourneyRequest } from "./journeyRequest.js";
import { composeReplyText, type DirectionResult } from "./replyComposer.js";
import { findCommuteTimesFromAttachments } from "./trainpal.js";

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
}

function resolveRequest(body: string, receivedAt: Date, pdfFilenames: string[]): ResolvedRequest | undefined {
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

  const date = textRequest?.date ?? (pdfTimes?.date ? new Date(pdfTimes.date) : startOfDay(receivedAt));
  return { date, outboundTime, returnTime };
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
      results.push(await checkDirection(rtt, "outbound", request.date, request.outboundTime));
    }
    if (request.returnTime) {
      results.push(await checkDirection(rtt, "return", request.date, request.returnTime));
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

  const replyText = composeReplyText(results, appUrl);
  await replyToMessage(agentMail, inboxId, messageId, replyText);
  await addLabel(agentMail, inboxId, messageId, PROCESSED_LABEL);
}

async function checkDirection(
  rtt: RttClient,
  direction: CommuteDirection,
  date: Date,
  time: string,
): Promise<DirectionResult> {
  const spec = buildCommuteJourneySpec(direction, date, time);
  const legs = await checkSplitJourney(rtt, spec);
  return { direction, legs };
}
