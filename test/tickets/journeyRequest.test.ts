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

describe("parseJourneyRequest 'took' lines", () => {
  it("applies a bare 'took:' to the only direction given", () => {
    const back = parseJourneyRequest("back: 20:05\ntook: 20:15", RECEIVED);
    expect(back.returnTime).toBe("2005");
    expect(back.returnTook).toBe("2015");
    expect(back.outboundTook).toBeUndefined();

    const out = parseJourneyRequest("out: 06:39\ntook 06:56", RECEIVED);
    expect(out.outboundTook).toBe("0656");
    expect(out.returnTook).toBeUndefined();
  });

  it("supports direction-specific 'took' lines when both out and back are given", () => {
    const req = parseJourneyRequest("out: 06:39\nback: 20:05\nback took: 20:15\nout took 0656", RECEIVED);
    expect(req.outboundTime).toBe("0639");
    expect(req.returnTime).toBe("2005");
    expect(req.outboundTook).toBe("0656");
    expect(req.returnTook).toBe("2015");
  });

  it("ignores an ambiguous bare 'took:' when both out and back are given", () => {
    const req = parseJourneyRequest("out: 06:39\nback: 20:05\ntook: 20:15", RECEIVED);
    expect(req.outboundTook).toBeUndefined();
    expect(req.returnTook).toBeUndefined();
  });

  it("does not let 'took' lines disturb the out/back times", () => {
    const req = parseJourneyRequest("back took: 20:15\nback: 20:05", RECEIVED);
    expect(req.returnTime).toBe("2005");
    expect(req.returnTook).toBe("2015");
  });
});

describe("parseJourneyRequest 'direct' lines", () => {
  it("applies a bare 'direct' line to every direction given", () => {
    const both = parseJourneyRequest("out: 06:54\nback: 21:05\ndirect", RECEIVED);
    expect(both.outboundDirect).toBe(true);
    expect(both.returnDirect).toBe(true);

    const outOnly = parseJourneyRequest("out: 06:54\ndirect", RECEIVED);
    expect(outOnly.outboundDirect).toBe(true);
    expect(outOnly.returnDirect).toBeUndefined();
  });

  it("supports direction-specific lines", () => {
    const req = parseJourneyRequest("out: 06:54\nback: 21:05\nout direct", RECEIVED);
    expect(req.outboundDirect).toBe(true);
    expect(req.returnDirect).toBeUndefined();

    const back = parseJourneyRequest("out: 06:54\nback: 21:05\nback direct", RECEIVED);
    expect(back.returnDirect).toBe(true);
    expect(back.outboundDirect).toBeUndefined();
  });

  it("is off by default and ignores the word inside other text, such as forwarded content", () => {
    expect(parseJourneyRequest("out: 06:54", RECEIVED).outboundDirect).toBeUndefined();

    const forwarded = parseJourneyRequest(
      "out: 06:54\n\n---------- Forwarded message ---------\nPay by direct debit or take a direct train",
      RECEIVED,
    );
    expect(forwarded.outboundDirect).toBeUndefined();
  });

  it("doesn't disturb the times", () => {
    const req = parseJourneyRequest("direct\nout: 06:54\nback: 21:05", RECEIVED);
    expect(req.outboundTime).toBe("0654");
    expect(req.returnTime).toBe("2105");
  });
});

