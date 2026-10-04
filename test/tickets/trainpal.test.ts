import { describe, expect, it } from "vitest";
import { findCommuteTimesFromAttachments, parseTicketFilename } from "../../src/tickets/trainpal.js";

// Real filenames from a TrainPal Brighton <-> London Bridge (via Gatwick Airport) booking.
const OUTBOUND_LEG1 = "passenger_Brighton_to_Gatwick Airport_23_Sep_0656.pdf";
const OUTBOUND_LEG2 = "passenger_Gatwick Airport_to_London Bridge_23_Sep_0736.pdf";
const RETURN_LEG1 = "passenger_London Bridge_to_Gatwick Airport.pdf";
const RETURN_LEG2 = "passenger_Gatwick Airport_to_Brighton.pdf";

describe("parseTicketFilename", () => {
  it("parses a leg with a fixed booked time", () => {
    const leg = parseTicketFilename(OUTBOUND_LEG1, 2026);
    expect(leg).toEqual({
      fromName: "Brighton",
      toName: "Gatwick Airport",
      fromCrs: "BTN",
      toCrs: "GTW",
      bookedTime: "0656",
      date: "2026-09-23",
    });
  });

  it("parses the connecting leg of the same journey", () => {
    const leg = parseTicketFilename(OUTBOUND_LEG2, 2026);
    expect(leg).toEqual({
      fromName: "Gatwick Airport",
      toName: "London Bridge",
      fromCrs: "GTW",
      toCrs: "LBG",
      bookedTime: "0736",
      date: "2026-09-23",
    });
  });

  it("parses an open-return leg with no fixed time or date", () => {
    const leg = parseTicketFilename(RETURN_LEG1, 2026);
    expect(leg).toEqual({
      fromName: "London Bridge",
      toName: "Gatwick Airport",
      fromCrs: "LBG",
      toCrs: "GTW",
      bookedTime: undefined,
      date: undefined,
    });
  });

  it("leaves fromCrs/toCrs undefined for an unrecognised station", () => {
    const leg = parseTicketFilename("passenger_Westminster_to_Victoria_01_Jan_0900.pdf", 2026);
    expect(leg?.fromCrs).toBeUndefined();
    expect(leg?.toCrs).toBeUndefined();
    expect(leg?.fromName).toBe("Westminster");
  });

  it("returns null for a filename that doesn't match the pattern", () => {
    expect(parseTicketFilename("E-receipt.pdf", 2026)).toBeNull();
  });
});

describe("findCommuteTimesFromAttachments", () => {
  it("finds the outbound booked time from a real booking's filenames", () => {
    const result = findCommuteTimesFromAttachments(
      [OUTBOUND_LEG1, OUTBOUND_LEG2, RETURN_LEG1, RETURN_LEG2],
      2026,
    );

    expect(result).toEqual({
      date: "2026-09-23",
      outboundTime: "0656",
      returnTime: undefined,
    });
  });

  it("finds a return time when the return leg has a fixed departure", () => {
    const result = findCommuteTimesFromAttachments(
      ["passenger_London Bridge_to_Gatwick Airport_23_Sep_1810.pdf"],
      2026,
    );

    expect(result.returnTime).toBe("1810");
  });

  it("returns an empty result when nothing matches the configured commute", () => {
    const result = findCommuteTimesFromAttachments(["E-receipt.pdf"], 2026);
    expect(result).toEqual({ date: undefined, outboundTime: undefined, returnTime: undefined });
  });
});
