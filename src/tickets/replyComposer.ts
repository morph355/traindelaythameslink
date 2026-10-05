import type { LegResult } from "../engine/types.js";
import type { TicketDetails } from "./ticketDetails.js";

export interface DirectionResult {
  direction: "outbound" | "return";
  legs: [LegResult, LegResult];
}

/** Ticket details read from the attached PDFs, keyed by "FROM-TO" CRS pair (e.g. "GTW-BTN"). */
export type TicketsByLeg = Record<string, TicketDetails>;

/** Plain-text reply body: ready to copy-paste into the Delay Repay form, no need to open the app. */
export function composeReplyText(results: DirectionResult[], appUrl?: string, tickets: TicketsByLeg = {}): string {
  const anyEligible = results.some((r) => r.legs.some((leg) => leg.compensation.eligible));
  const header = anyEligible
    ? "You can claim Delay Repay on at least one ticket - details below."
    : "No ticket here clears the 15-minute Delay Repay threshold.";

  const sections = results.map((r) => renderDirection(r, tickets));
  const footer = appUrl ? `Check another journey: ${appUrl}` : undefined;

  return [header, "", ...sections, footer].filter((line) => line !== undefined).join("\n");
}

function renderDirection(result: DirectionResult, tickets: TicketsByLeg): string {
  const title = result.direction === "outbound" ? "OUTBOUND" : "RETURN";
  const legs = result.legs.map((leg) => renderLeg(leg, tickets[`${leg.leg.fromCrs}-${leg.leg.toCrs}`]));
  return [title, ...legs, ""].join("\n");
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDate(date: Date): string {
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

function renderTicket(ticket: TicketDetails): string {
  const type = [ticket.ticketType, ticket.restriction && `(${ticket.restriction})`].filter(Boolean).join(" ");
  return `  Ticket: ${type || "type not found"}, ticket number ${ticket.ticketNumber}, price £${ticket.priceGbp.toFixed(2)}`;
}

function renderLeg(leg: LegResult, ticket?: TicketDetails): string {
  const lines = [
    `  ${leg.leg.fromCrs} -> ${leg.leg.toCrs}${leg.leg.ticketLabel ? ` (${leg.leg.ticketLabel})` : ""}`,
    `  Date: ${formatDate(leg.leg.date)}`,
    ...(leg.taken.legScheduledDeparture
      ? [
          `  Booked departure ${leg.taken.legScheduledDeparture} from ${leg.leg.fromCrs}` +
            (leg.taken.legActualDeparture ? `, actually left ${leg.taken.legActualDeparture}` : ""),
        ]
      : []),
    leg.taken.replacesServiceUid
      ? `  Booked service ${leg.taken.replacesServiceUid} was cancelled/terminated early; you took ${leg.taken.serviceUid}. ` +
        `Due ${leg.taken.scheduledArrival} (booked service), actual arrival ${leg.taken.actualArrival} - ${leg.delayMinutes} min late`
      : leg.taken.cancelled
      ? `  CANCELLED before ${leg.leg.toCrs} (service ${leg.taken.serviceUid}, scheduled arrival ${leg.taken.scheduledArrival})`
      : `  Scheduled arrival ${leg.taken.scheduledArrival}, actual arrival ${leg.taken.actualArrival} - ${leg.delayMinutes} min late`,
    `  ${leg.compensation.eligible ? "ELIGIBLE" : "Not eligible"} - ${leg.compensation.label}` +
      (leg.compensation.eligible ? ` (${leg.compensation.percentOfFare}% of this ticket's fare)` : ""),
  ];

  if (leg.compensation.eligible) {
    lines.push(
      ticket
        ? renderTicket(ticket)
        : "  Ticket: not found in the attached PDFs (forward your TrainPal booking email to include the ticket number, type and price)",
      `  Reason for delay: ${leg.taken.delayReason ?? "none published by Realtime Trains for this train"}`,
    );
  }

  lines.push(
    leg.alternatives.fasterAlternativeFound
      ? `  Note: a faster alternative existed (arrived ${leg.alternatives.bestAlternativeArrival}, ` +
          `${leg.alternatives.minutesEarlierThanTaken} min earlier than the service taken).`
      : `  Checked ${leg.alternatives.checkedCount} alternative service(s) - none arrived earlier.`,
  );

  return lines.join("\n");
}
