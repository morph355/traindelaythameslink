import type { Leg } from "../engine/types.js";
import type { SplitJourneySpec } from "../rtt/checkSplitJourney.js";

export interface CommutePreset {
  label: string;
  /** HHmm */
  time: string;
}

export type CommuteDirection = "outbound" | "return";

/**
 * Your regular split-save commute. Edit this if your route, split point, or
 * usual departure times change - it's the only place they're defined.
 */
export const COMMUTE = {
  fromCrs: "BTN",
  fromName: "Brighton",
  viaCrs: "GTW",
  viaName: "Gatwick Airport",
  toCrs: "LBG",
  toName: "London Bridge",
  /** Preset outbound departure times from `fromCrs`. Return has no presets - it's less regular. */
  outboundPresets: [
    { label: "06:39", time: "0639" },
    { label: "06:56", time: "0656" },
  ] as CommutePreset[],
  ticketLabels: {
    outboundLeg1: "Brighton to Gatwick Airport",
    outboundLeg2: "Gatwick Airport to London Bridge",
    returnLeg1: "London Bridge to Gatwick Airport",
    returnLeg2: "Gatwick Airport to Brighton",
    outboundDirect: "Brighton to London Bridge (direct ticket)",
    returnDirect: "London Bridge to Brighton (direct ticket)",
  },
};

/**
 * One ticket for the whole journey (e.g. a direct off-peak ticket bought instead
 * of the split-save pair): a single leg from one end of the commute to the other.
 */
export function buildDirectLeg(direction: CommuteDirection, date: Date, bookedDepartureTime: string): Leg {
  const outbound = direction === "outbound";
  return {
    fromCrs: outbound ? COMMUTE.fromCrs : COMMUTE.toCrs,
    toCrs: outbound ? COMMUTE.toCrs : COMMUTE.fromCrs,
    date,
    bookedDepartureTime,
    ticketLabel: outbound ? COMMUTE.ticketLabels.outboundDirect : COMMUTE.ticketLabels.returnDirect,
  };
}

/** Builds a `checkSplitJourney` spec for your regular commute in either direction. */
export function buildCommuteJourneySpec(
  direction: CommuteDirection,
  date: Date,
  bookedDepartureTime: string,
  tookDepartureTime?: string,
): SplitJourneySpec {
  const outbound = direction === "outbound";
  return {
    fromCrs: outbound ? COMMUTE.fromCrs : COMMUTE.toCrs,
    viaCrs: COMMUTE.viaCrs,
    toCrs: outbound ? COMMUTE.toCrs : COMMUTE.fromCrs,
    date,
    bookedDepartureTime,
    tookDepartureTime,
    ticketLabels: outbound
      ? { leg1: COMMUTE.ticketLabels.outboundLeg1, leg2: COMMUTE.ticketLabels.outboundLeg2 }
      : { leg1: COMMUTE.ticketLabels.returnLeg1, leg2: COMMUTE.ticketLabels.returnLeg2 },
  };
}
