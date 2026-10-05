import type { LegResult } from "../engine/types.js";

export interface DirectionResult {
  direction: "outbound" | "return";
  legs: [LegResult, LegResult];
}

/** Plain-text reply body: ready to copy-paste into the Delay Repay form, no need to open the app. */
export function composeReplyText(results: DirectionResult[], appUrl?: string): string {
  const anyEligible = results.some((r) => r.legs.some((leg) => leg.compensation.eligible));
  const header = anyEligible
    ? "You can claim Delay Repay on at least one ticket - details below."
    : "No ticket here clears the 15-minute Delay Repay threshold.";

  const sections = results.map(renderDirection);
  const footer = appUrl ? `Check another journey: ${appUrl}` : undefined;

  return [header, "", ...sections, footer].filter((line) => line !== undefined).join("\n");
}

function renderDirection(result: DirectionResult): string {
  const title = result.direction === "outbound" ? "OUTBOUND" : "RETURN";
  return [title, ...result.legs.map(renderLeg), ""].join("\n");
}

function renderLeg(leg: LegResult): string {
  const lines = [
    `  ${leg.leg.fromCrs} -> ${leg.leg.toCrs}${leg.leg.ticketLabel ? ` (${leg.leg.ticketLabel})` : ""}`,
    leg.taken.cancelled
      ? `  CANCELLED before ${leg.leg.toCrs} (service ${leg.taken.serviceUid}, scheduled arrival ${leg.taken.scheduledArrival})`
      : `  Scheduled arrival ${leg.taken.scheduledArrival}, actual arrival ${leg.taken.actualArrival} - ${leg.delayMinutes} min late`,
    `  ${leg.compensation.eligible ? "ELIGIBLE" : "Not eligible"} - ${leg.compensation.label}` +
      (leg.compensation.eligible ? ` (${leg.compensation.percentOfFare}% of this ticket's fare)` : ""),
  ];

  lines.push(
    leg.alternatives.fasterAlternativeFound
      ? `  Note: a faster alternative existed (arrived ${leg.alternatives.bestAlternativeArrival}, ` +
          `${leg.alternatives.minutesEarlierThanTaken} min earlier than the service taken).`
      : `  Checked ${leg.alternatives.checkedCount} alternative service(s) - none arrived earlier.`,
  );

  return lines.join("\n");
}
