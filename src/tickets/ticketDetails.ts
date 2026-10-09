/**
 * Claim details read from the text of a TrainPal e-ticket PDF, e.g.:
 *
 *   TICKET TYPE ROUTE
 *   Anytime Day Return Thameslink Only
 *   ...
 *   Ticket Number CPB6E28SD33
 *   Price £ 15.90
 *
 * A return ticket has one PDF per direction carrying the same ticket number
 * and the *whole* return price. Stations are deliberately not read from the
 * body (see trainpal.ts: it shows fare-group codes like THK for London
 * Bridge) - match tickets to journey legs by filename instead.
 */
export interface TicketDetails {
  ticketNumber: string;
  /** e.g. "Anytime Day Return". Falls back to the whole line if the wording is unfamiliar. */
  ticketType?: string;
  /** e.g. "Thameslink Only", "Not Underground". */
  restriction?: string;
  /** Full ticket price as printed (for a return, the return price). */
  priceGbp: number;
}

const TYPE_PATTERN =
  /^(Anytime|Off[- ]?Peak|Super Off[- ]?Peak|Advance|Peak)\s+((?:Day\s+)?(?:Single|Return))\b\s*(.*)$/i;

/** Returns undefined if the text has no ticket number and price (e.g. the E-receipt). */
export function parseTicketText(text: string): TicketDetails | undefined {
  const ticketNumber = /Ticket Number\s+([A-Z0-9]+)/i.exec(text)?.[1];
  const price = /Price\s*£\s*([\d,]+(?:\.\d{1,2})?)/i.exec(text)?.[1];
  if (!ticketNumber || !price) return undefined;

  const typeLine = /TICKET TYPE[^\n]*\n([^\n]+)/i.exec(text)?.[1]?.trim();
  const typeMatch = typeLine ? TYPE_PATTERN.exec(typeLine) : null;

  return {
    ticketNumber,
    ticketType: typeMatch ? `${typeMatch[1]} ${typeMatch[2]}` : typeLine,
    restriction: typeMatch?.[3]?.trim() || undefined,
    priceGbp: Number(price.replace(/,/g, "")),
  };
}
