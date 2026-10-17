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

describe("parseCommuteRequest direct and took", () => {
  it("accepts a direct ticket and the train actually taken", () => {
    const req = parseCommuteRequest({ direction: "outbound", date: "2026-09-23", time: "06:39", took: "06:56", direct: true });
    expect(req.direct).toBe(true);
    expect(req.tookDepartureTime).toBe("0656");
  });

  it("leaves both unset by default", () => {
    const req = parseCommuteRequest({ direction: "outbound", date: "2026-09-23", time: "0639" });
    expect(req.direct).toBeUndefined();
    expect(req.tookDepartureTime).toBeUndefined();
  });

  it("rejects a malformed took time", () => {
    expect(() => parseCommuteRequest({ direction: "outbound", date: "2026-09-23", time: "0639", took: "late" })).toThrow(
      ValidationError,
    );
  });
});
