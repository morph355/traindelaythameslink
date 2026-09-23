import { describe, expect, it } from "vitest";
import { composeReplyText, type DirectionResult } from "../../src/tickets/replyComposer.js";
import type { Leg, LegResult, ServicePerformance } from "../../src/engine/types.js";

function leg(overrides: Partial<Leg> = {}): Leg {
  return {
    fromCrs: "BTN",
    toCrs: "GTW",
    date: new Date(2026, 8, 23),
    bookedDepartureTime: "0639",
    ticketLabel: "Brighton to Gatwick Airport",
    ...overrides,
  };
}

function taken(overrides: Partial<ServicePerformance> = {}): ServicePerformance {
  return {
    serviceUid: "G12345",
    runDate: "2026-09-23",
    scheduledArrival: "0705",
    actualArrival: "0719",
    arrivalIsActual: true,
    cancelled: false,
    ...overrides,
  };
}

function eligibleLeg(): LegResult {
  return {
    leg: leg(),
    taken: taken(),
    delayMinutes: 22,
    compensation: { eligible: true, label: "15-29 minutes", percentOfFare: 25 },
    alternatives: { checkedCount: 1, fasterAlternativeFound: false, lines: ["ALT1: ..."] },
  };
}

function notEligibleLeg(): LegResult {
  return {
    leg: leg({ fromCrs: "GTW", toCrs: "LBG", ticketLabel: "Gatwick Airport to London Bridge" }),
    taken: taken({ actualArrival: "0710" }),
    delayMinutes: 5,
    compensation: { eligible: false, label: "Under 15 minutes - not eligible", percentOfFare: 0 },
    alternatives: {
      checkedCount: 1,
      fasterAlternativeFound: true,
      bestAlternativeArrival: "0700",
      minutesEarlierThanTaken: 10,
      lines: ["ALT2: ..."],
    },
  };
}

describe("composeReplyText", () => {
  it("leads with an eligible summary and lists both legs when eligible", () => {
    const results: DirectionResult[] = [{ direction: "outbound", legs: [eligibleLeg(), notEligibleLeg()] }];

    const text = composeReplyText(results, "https://thameslink.example.com");

    expect(text).toMatch(/^You can claim Delay Repay/);
    expect(text).toContain("OUTBOUND");
    expect(text).toContain("BTN -> GTW (Brighton to Gatwick Airport)");
    expect(text).toContain("ELIGIBLE - 15-29 minutes (25% of this ticket's fare)");
    expect(text).toContain("Not eligible - Under 15 minutes - not eligible");
    expect(text).toContain("a faster alternative existed (arrived 0700, 10 min earlier");
    expect(text).toContain("Check another journey: https://thameslink.example.com");
  });

  it("leads with a not-eligible summary when nothing clears the threshold", () => {
    const results: DirectionResult[] = [{ direction: "return", legs: [notEligibleLeg(), notEligibleLeg()] }];

    const text = composeReplyText(results);

    expect(text).toMatch(/^No ticket here clears/);
    expect(text).toContain("RETURN");
    expect(text).not.toContain("Check another journey");
  });

  it("renders multiple directions", () => {
    const results: DirectionResult[] = [
      { direction: "outbound", legs: [eligibleLeg(), eligibleLeg()] },
      { direction: "return", legs: [notEligibleLeg(), notEligibleLeg()] },
    ];

    const text = composeReplyText(results);

    expect(text.indexOf("OUTBOUND")).toBeLessThan(text.indexOf("RETURN"));
  });
});
