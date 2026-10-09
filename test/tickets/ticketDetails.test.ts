import { describe, expect, it } from "vitest";
import { parseTicketText } from "../../src/tickets/ticketDetails.js";

// Same layout as a real TrainPal e-ticket PDF's extracted text (ticket numbers made up).
const OUTBOUND = [
  "CPB0TEST001",
  "23 Sep 2026 Out: BTN - GTW",
  "BRIGHTON GATWICK AIRPORT",
  "BTN GTW",
  "TICKET TYPE ROUTE",
  "Anytime Day Return Thameslink Only",
  "ADULT VALID UNTIL",
  "- 23 Sep 2026",
  "Itinerary - Optional Reservations 23 September:",
  "06:56 Thameslink",
  "Ticket details:",
  "Ticket Number CPB0TEST001",
  "Price £ 15.90",
  "Purchased on 23 September 2026",
  "Your order ID: 11111111111",
].join("\n");

describe("parseTicketText", () => {
  it("reads ticket number, type, restriction and full price", () => {
    expect(parseTicketText(OUTBOUND)).toEqual({
      ticketNumber: "CPB0TEST001",
      ticketType: "Anytime Day Return",
      restriction: "Thameslink Only",
      priceGbp: 15.9,
    });
  });

  it("reads other ticket types and prices over £99", () => {
    const text = "TICKET TYPE ROUTE\nOff-Peak Single Any Permitted\nTicket Number AB12\nPrice £ 1,234.50";
    expect(parseTicketText(text)).toMatchObject({ ticketType: "Off-Peak Single", restriction: "Any Permitted", priceGbp: 1234.5 });
  });

  it("falls back to the whole type line when the wording is unfamiliar", () => {
    const text = "TICKET TYPE ROUTE\nSeason Flexi Pass Anywhere\nTicket Number X1\nPrice £ 5.00";
    expect(parseTicketText(text)).toMatchObject({ ticketType: "Season Flexi Pass Anywhere", restriction: undefined });
  });

  it("returns undefined for text with no ticket number and price, like the E-receipt", () => {
    expect(parseTicketText("Expense Receipt\nOrder ID: 1\nTotal: £42.80")).toBeUndefined();
  });
});
