import { describe, expect, it } from "vitest";
import { parseCommuteRequest } from "../../src/server/parseCommuteRequest.js";
import { ValidationError } from "../../src/server/parseLegs.js";

describe("parseCommuteRequest", () => {
  it("parses a valid outbound request", () => {
    const req = parseCommuteRequest({ direction: "outbound", date: "2026-09-23", time: "06:39" });
    expect(req.direction).toBe("outbound");
    expect(req.bookedDepartureTime).toBe("0639");
    expect(req.date.getDate()).toBe(23);
  });

  it("parses a valid return request", () => {
    const req = parseCommuteRequest({ direction: "return", date: "2026-09-23", time: "1810" });
    expect(req.direction).toBe("return");
    expect(req.bookedDepartureTime).toBe("1810");
  });

  it("rejects an invalid direction", () => {
    expect(() => parseCommuteRequest({ direction: "sideways", date: "2026-09-23", time: "0639" })).toThrow(
      ValidationError,
    );
  });

  it("collects multiple issues", () => {
    try {
      parseCommuteRequest({});
      expect.fail("expected ValidationError");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).issues).toHaveLength(3);
    }
  });
});
