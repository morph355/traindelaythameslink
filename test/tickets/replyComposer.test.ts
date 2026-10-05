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

describe("composeReplyText for a cancelled leg", () => {
  it("says the service was cancelled instead of printing a missing actual arrival", () => {
    const cancelledLeg: LegResult = {
      leg: leg({ fromCrs: "GTW", toCrs: "BTN", ticketLabel: "Gatwick Airport to Brighton" }),
      taken: taken({ serviceUid: "W45563", scheduledArrival: "2113", actualArrival: undefined, arrivalIsActual: false, cancelled: true }),
      delayMinutes: 16,
      compensation: { eligible: true, label: "Cancelled - estimated from the first alternative that ran", percentOfFare: 25 },
      alternatives: { checkedCount: 1, fasterAlternativeFound: false, lines: ["ALT: ..."] },
    };

    const text = composeReplyText([{ direction: "return", legs: [notEligibleLeg(), cancelledLeg] }]);

    expect(text).toContain("Scheduled arrival: 21:13   Actual arrival: none - service W45563 was cancelled before BTN");
    expect(text).not.toContain("actual arrival undefined");
    expect(text).toContain("ELIGIBLE - Cancelled");
  });
});

describe("composeReplyText when the booked train was replaced", () => {
  it("names both the booked service and the train taken", () => {
    const replaced: LegResult = {
      leg: leg({ fromCrs: "GTW", toCrs: "BTN" }),
      taken: taken({ serviceUid: "W45483", replacesServiceUid: "W45563", scheduledArrival: "2113", actualArrival: "2129" }),
      delayMinutes: 16,
      compensation: { eligible: true, label: "15-29 minutes", percentOfFare: 25 },
      alternatives: { checkedCount: 1, fasterAlternativeFound: false, lines: [] },
    };

    const text = composeReplyText([{ direction: "return", legs: [notEligibleLeg(), replaced] }]);

    expect(text).toContain("Scheduled arrival: 21:13   Actual arrival: 21:29 - 16 min late");
    expect(text).toContain("Booked service W45563 was cancelled/terminated early; the arrival is on W45483, which you took.");
  });
});

describe("composeReplyText claim details", () => {
  const ticketA = { ticketNumber: "CPB0TEST001", ticketType: "Anytime Day Return", restriction: "Thameslink Only", priceGbp: 15.9 };

  function delayedLeg(overrides: Partial<ServicePerformance> = {}): LegResult {
    return {
      leg: leg({ fromCrs: "BTN", toCrs: "GTW", ticketLabel: "Brighton to Gatwick Airport" }),
      taken: taken({ scheduledArrival: "0735", actualArrival: "0750", legScheduledDeparture: "0656", legActualDeparture: "0656", ...overrides }),
      delayMinutes: 15,
      compensation: { eligible: true, label: "15-29 minutes", percentOfFare: 25 },
      alternatives: { checkedCount: 1, fasterAlternativeFound: false, lines: [] },
    };
  }

  it("shows date, booked and actual departure, ticket number/type/full price and the RTT reason", () => {
    const text = composeReplyText(
      [{ direction: "outbound", legs: [delayedLeg({ delayReason: "train fault - a problem with the brakes" }), notEligibleLeg()] }],
      undefined,
      { "BTN-GTW": ticketA },
    );

    expect(text).toContain("Date: Wed 23 Sep 2026");
    expect(text).toContain("Scheduled departure: 06:56   Actual departure: 06:56");
    expect(text).toContain("Ticket: Anytime Day Return (Thameslink Only), ticket number CPB0TEST001, price £15.90");
    expect(text).toContain("Reason for delay: train fault - a problem with the brakes");
    expect(text).not.toContain("order");
  });

  it("says when RTT published no reason, and when no ticket was found in the PDFs", () => {
    const text = composeReplyText([{ direction: "outbound", legs: [delayedLeg(), notEligibleLeg()] }]);

    expect(text).toContain("Reason for delay: none published by Realtime Trains for this train");
    expect(text).toContain("Ticket: not found in the attached PDFs");
  });

  it("leaves out ticket and reason lines for a leg that isn't eligible", () => {
    const text = composeReplyText([{ direction: "outbound", legs: [notEligibleLeg(), notEligibleLeg()] }], undefined, {
      "GTW-LBG": ticketA,
    });

    expect(text).not.toContain("Ticket:");
    expect(text).not.toContain("Reason for delay");
  });
});

describe("composeReplyText times", () => {
  it("shows scheduled and actual departure and arrival for every leg, eligible or not", () => {
    const withDeparture = (l: LegResult, sched: string, actual: string): LegResult => ({
      ...l,
      taken: { ...l.taken, legScheduledDeparture: sched, legActualDeparture: actual },
    });

    const text = composeReplyText([
      { direction: "outbound", legs: [withDeparture(eligibleLeg(), "0656", "0656"), withDeparture(notEligibleLeg(), "0736", "0741")] },
    ]);

    expect(text).toContain("Scheduled departure: 06:56   Actual departure: 06:56");
    expect(text).toContain("Scheduled arrival: 07:05   Actual arrival: 07:19 - 22 min late");
    expect(text).toContain("Scheduled departure: 07:36   Actual departure: 07:41");
    expect(text).toContain("Scheduled arrival: 07:05   Actual arrival: 07:10 - 5 min late");
  });

  it("says plainly when a time isn't available rather than leaving it out", () => {
    const text = composeReplyText([{ direction: "outbound", legs: [eligibleLeg(), notEligibleLeg()] }]);

    expect(text).toContain("Scheduled departure: not available   Actual departure: not recorded");
  });
});

