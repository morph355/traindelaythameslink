import { describe, expect, it } from "vitest";
import { JourneyRequestParseError, parseJourneyRequest } from "../../src/tickets/journeyRequest.js";

const RECEIVED = new Date(2026, 8, 23, 19, 30);

describe("parseJourneyRequest", () => {
  it("parses both legs with a colon", () => {
    const req = parseJourneyRequest("out: 06:39\nback: 18:12", RECEIVED);
    expect(req.outboundTime).toBe("0639");
    expect(req.returnTime).toBe("1812");
    expect(req.date).toEqual(new Date(2026, 8, 23));
  });

  it("parses just one leg", () => {
    const outOnly = parseJourneyRequest("Hi, out 6:39 this morning, delayed badly", RECEIVED);
    expect(outOnly.outboundTime).toBe("0639");
    expect(outOnly.returnTime).toBeUndefined();

    const backOnly = parseJourneyRequest("back: 1812", RECEIVED);
    expect(backOnly.returnTime).toBe("1812");
    expect(backOnly.outboundTime).toBeUndefined();
  });

  it("accepts return/inbound/outbound synonyms and dotted times", () => {
    const req = parseJourneyRequest("outbound 06.39\nreturn 18.12", RECEIVED);
    expect(req.outboundTime).toBe("0639");
    expect(req.returnTime).toBe("1812");

    const req2 = parseJourneyRequest("inbound: 18:12", RECEIVED);
    expect(req2.returnTime).toBe("1812");
  });

  it("is case-insensitive and ignores surrounding text", () => {
    const req = parseJourneyRequest(
      "Hi there,\n\nOUT: 06:39\n\nToday was rough.\n\nThanks,\nMe",
      RECEIVED,
    );
    expect(req.outboundTime).toBe("0639");
  });

  it("defaults the date to the day the email was received", () => {
    const req = parseJourneyRequest("out: 06:39", RECEIVED);
    expect(req.date).toEqual(new Date(2026, 8, 23));
  });

  it("reports whether the date was given explicitly", () => {
    expect(parseJourneyRequest("out: 06:39", RECEIVED).dateSpecified).toBe(false);
    expect(parseJourneyRequest("date: 2026-09-20\nout: 06:39", RECEIVED).dateSpecified).toBe(true);
    expect(parseJourneyRequest("date: today\nout: 06:39", RECEIVED).dateSpecified).toBe(true);
  });

  it("resolves an explicit date", () => {
    const req = parseJourneyRequest("date: 2026-09-20\nout: 06:39", RECEIVED);
    expect(req.date).toEqual(new Date(2026, 8, 20));
  });

  it("resolves 'yesterday' relative to the received date", () => {
    const req = parseJourneyRequest("date: yesterday\nout: 06:39", RECEIVED);
    expect(req.date).toEqual(new Date(2026, 8, 22));
  });

  it("throws JourneyRequestParseError when neither leg is found", () => {
    expect(() => parseJourneyRequest("Hello, just checking in.", RECEIVED)).toThrow(JourneyRequestParseError);
  });
});
