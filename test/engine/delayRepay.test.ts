import { describe, expect, it } from "vitest";
import {
  compensationTier,
  delayMinutes,
  evaluateLeg,
  minutesOfDay,
  summarizeAlternatives,
} from "../../src/engine/delayRepay.js";
import type { Leg, ServicePerformance } from "../../src/engine/types.js";

function perf(overrides: Partial<ServicePerformance> = {}): ServicePerformance {
  return {
    serviceUid: "G12345",
    runDate: "2026-09-23",
    scheduledDeparture: "0812",
    scheduledArrival: "0910",
    actualArrival: "0910",
    arrivalIsActual: true,
    cancelled: false,
    ...overrides,
  };
}

describe("minutesOfDay", () => {
  it("parses HHmm into minutes since midnight", () => {
    expect(minutesOfDay("0812")).toBe(8 * 60 + 12);
    expect(minutesOfDay("2359")).toBe(23 * 60 + 59);
  });
});

describe("delayMinutes", () => {
  it("returns 0 when on time or early", () => {
    expect(delayMinutes("0910", "0910")).toBe(0);
    expect(delayMinutes("0910", "0905")).toBe(0);
  });

  it("returns the minutes late", () => {
    expect(delayMinutes("0910", "0932")).toBe(22);
  });

  it("handles a delay that rolls past midnight", () => {
    // scheduled 23:50, actual arrival logged as 00:10 the next day
    expect(delayMinutes("2350", "0010")).toBe(20);
  });
});

describe("compensationTier", () => {
  it("is not eligible under 15 minutes", () => {
    expect(compensationTier(14)).toEqual({
      eligible: false,
      label: "Under 15 minutes - not eligible",
      percentOfFare: 0,
    });
  });

  it.each([
    [15, "15-29 minutes", 25],
    [29, "15-29 minutes", 25],
    [30, "30-59 minutes", 50],
    [59, "30-59 minutes", 50],
    [60, "60-119 minutes", 100],
    [119, "60-119 minutes", 100],
    [120, "120+ minutes", 100],
    [240, "120+ minutes", 100],
  ])("tiers %i minutes late as %s at %i%%", (minutes, label, percent) => {
    const tier = compensationTier(minutes);
    expect(tier.eligible).toBe(true);
    expect(tier.label).toBe(label);
    expect(tier.percentOfFare).toBe(percent);
  });
});

describe("summarizeAlternatives", () => {
  it("reports no faster alternative when every other service was also delayed", () => {
    const taken = perf({ serviceUid: "TAKEN", scheduledArrival: "0910", actualArrival: "0935" });
    const alt = perf({ serviceUid: "ALT1", scheduledArrival: "0830", actualArrival: "0940" });

    const summary = summarizeAlternatives(taken, [taken, alt]);

    expect(summary.checkedCount).toBe(1);
    expect(summary.fasterAlternativeFound).toBe(false);
    expect(summary.lines[0]).toContain("ALT1");
  });

  it("flags a genuinely faster alternative that existed", () => {
    const taken = perf({ serviceUid: "TAKEN", scheduledArrival: "0910", actualArrival: "0935" });
    const fasterAlt = perf({ serviceUid: "ALT-FAST", scheduledArrival: "0850", actualArrival: "0902" });

    const summary = summarizeAlternatives(taken, [taken, fasterAlt]);

    expect(summary.fasterAlternativeFound).toBe(true);
    expect(summary.bestAlternativeArrival).toBe("0902");
    expect(summary.minutesEarlierThanTaken).toBe(33);
  });

  it("ignores cancelled alternatives and the taken service itself", () => {
    const taken = perf({ serviceUid: "TAKEN", scheduledArrival: "0910", actualArrival: "0935" });
    const cancelled = perf({ serviceUid: "ALT-CANCELLED", cancelled: true, actualArrival: undefined });

    const summary = summarizeAlternatives(taken, [taken, cancelled]);

    expect(summary.checkedCount).toBe(0);
    expect(summary.fasterAlternativeFound).toBe(false);
  });
});

describe("evaluateLeg", () => {
  const leg: Leg = {
    fromCrs: "STP",
    toCrs: "BTN",
    date: new Date(2026, 8, 23),
    bookedDepartureTime: "0812",
    ticketLabel: "St Pancras to Three Bridges",
  };

  it("computes delay and eligibility for the leg", () => {
    const taken = perf({ scheduledArrival: "0910", actualArrival: "0932" });
    const result = evaluateLeg(leg, taken, [taken]);

    expect(result.delayMinutes).toBe(22);
    expect(result.compensation.eligible).toBe(true);
    expect(result.compensation.percentOfFare).toBe(25);
  });

  it("throws if the taken service has no reported arrival yet", () => {
    const taken = perf({ actualArrival: undefined });
    expect(() => evaluateLeg(leg, taken, [])).toThrow(/missing scheduled or actual arrival/);
  });
});
