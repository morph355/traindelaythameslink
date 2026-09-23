import { describe, expect, it } from "vitest";
import { ValidationError, parseLegs } from "../../src/server/parseLegs.js";

describe("parseLegs", () => {
  it("parses a valid single leg", () => {
    const [leg] = parseLegs([
      { fromCrs: "stp", toCrs: "btn", date: "2026-09-23", bookedDepartureTime: "08:12", ticketLabel: " Off-Peak " },
    ]);

    expect(leg.fromCrs).toBe("STP");
    expect(leg.toCrs).toBe("BTN");
    expect(leg.bookedDepartureTime).toBe("0812");
    expect(leg.ticketLabel).toBe("Off-Peak");
    expect(leg.date.getFullYear()).toBe(2026);
    expect(leg.date.getMonth()).toBe(8);
    expect(leg.date.getDate()).toBe(23);
  });

  it("accepts HHmm time format without a colon", () => {
    const [leg] = parseLegs([{ fromCrs: "STP", toCrs: "BTN", date: "2026-09-23", bookedDepartureTime: "0812" }]);
    expect(leg.bookedDepartureTime).toBe("0812");
  });

  it("rejects an empty leg list", () => {
    expect(() => parseLegs([])).toThrow(ValidationError);
  });

  it("collects issues across multiple invalid fields and legs", () => {
    try {
      parseLegs([
        { fromCrs: "STPX", toCrs: "BTN", date: "2026-09-23", bookedDepartureTime: "0812" },
        { fromCrs: "STP", toCrs: "BTN", date: "not-a-date", bookedDepartureTime: "0812" },
      ]);
      expect.fail("expected ValidationError");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const issues = (err as ValidationError).issues;
      expect(issues.some((i) => i.startsWith("Leg 1") && i.includes("from"))).toBe(true);
      expect(issues.some((i) => i.startsWith("Leg 2") && i.includes("date"))).toBe(true);
    }
  });
});
