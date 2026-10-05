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
    expect(req).toEqual({ date: new Date(2026, 8, 23), outboundTime: "0656", returnTime: "2005" });
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
