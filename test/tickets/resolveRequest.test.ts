import { describe, expect, it } from "vitest";
import { resolveRequest } from "../../src/tickets/processJourneyRequests.js";

// A forwarded booking for 23 Sept, emailed on 4 Oct with just the times.
const SENT = new Date(2026, 9, 4, 15, 45);
const PDFS = [
  "E-receipt.pdf",
  "passenger_Brighton_to_Gatwick Airport_23_Sep_0656.pdf",
  "passenger_Gatwick Airport_to London Bridge_23_Sep_0736.pdf",
  "passenger_Gatwick Airport_to Brighton.pdf",
  "passenger_London Bridge_to_Gatwick Airport.pdf",
];

describe("resolveRequest date", () => {
  it("uses the booking PDFs' date, not the send date, when the text has times but no date", () => {
    const req = resolveRequest("out: 06:56\nback: 20:05", SENT, PDFS);
    expect(req).toEqual({
      date: new Date(2026, 8, 23),
      outbound: { time: "0656" },
      return: { time: "2005" },
    });
  });

  it("lets an explicit date line override the PDFs", () => {
    const req = resolveRequest("date: 2026-09-24\nout: 06:56", SENT, PDFS);
    expect(req?.date).toEqual(new Date(2026, 8, 24));
  });

  it("falls back to the send date with no PDFs and no date line", () => {
    const req = resolveRequest("out: 06:56", SENT, []);
    expect(req?.date).toEqual(new Date(2026, 9, 4));
  });
});

describe("resolveRequest took", () => {
  it("keeps the train taken with its direction, including for a direct ticket", () => {
    const req = resolveRequest("out: 07:56\nout direct\nout took: 08:10", SENT, []);
    expect(req?.outbound).toMatchObject({ time: "0756", took: "0810", direct: true });
  });
});

describe("resolveRequest direct tickets", () => {
  const DIRECT_PDFS = [
    "E-receipt.pdf",
    "passenger_Brighton_to_London Bridge_4_Oct_0756.pdf",
    "passenger_London Bridge_to_Brighton.pdf",
  ];

  it("treats a whole-journey ticket in the attachments as direct, without any keyword", () => {
    const req = resolveRequest("out: 07:56\nback: 20:05", SENT, DIRECT_PDFS);
    expect(req).toMatchObject({
      outbound: { time: "0756", direct: true },
      return: { time: "2005", direct: true },
    });
  });

  it("uses the 'direct' keyword when there are no direct tickets attached", () => {
    const req = resolveRequest("out: 07:56\ndirect", SENT, PDFS);
    expect(req).toMatchObject({ outbound: { time: "0756", direct: true } });
    expect(req?.return).toBeUndefined();
  });

  it("stays split-save with neither", () => {
    const req = resolveRequest("out: 06:56\nback: 20:05", SENT, PDFS);
    expect(req?.outbound?.direct).toBeUndefined();
    expect(req?.return?.direct).toBeUndefined();
  });
});

