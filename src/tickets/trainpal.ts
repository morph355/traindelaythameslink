import { COMMUTE } from "../config/commute.js";

/**
 * Parses TrainPal e-ticket PDF attachments. TrainPal names each ticket PDF
 * descriptively, e.g. "passenger_Brighton_to_Gatwick Airport_23_Sep_0656.pdf"
 * (fixed departure) or "passenger_Gatwick Airport_to_Brighton.pdf" (an open
 * return, no fixed time). That filename turns out to be a more reliable
 * source of the real station names than the PDF body text: for a London
 * terminus the body text shows a fare-group code instead of the specific
 * station actually booked (e.g. "THK" / "LONDON THAMESLINK" for any
 * Thameslink-served London station) - the real name only appears in the
 * filename, in the outbound leg's itinerary line, or in the overall
 * E-receipt, none of which is as consistently present as the filename.
 */

export interface ParsedTicketLeg {
  fromName: string;
  toName: string;
  fromCrs?: string;
  toCrs?: string;
  /** HHmm. Absent for an open return with no fixed departure. */
  bookedTime?: string;
  /** yyyy-mm-dd, derived from the filename's day/month plus the given year hint. */
  date?: string;
}

const FILENAME_PATTERN = /^passenger_(.+?)_to_(.+?)(?:_(\d{1,2})_([A-Za-z]{3})_(\d{3,4}))?\.pdf$/i;

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/**
 * Known station name -> CRS mappings. Deliberately small - this app only
 * ever needs to resolve stations on the user's own commute, so extend as
 * new routes come up rather than trying to cover every GB station.
 */
const STATION_CRS: Record<string, string> = {
  brighton: "BTN",
  "gatwick airport": "GTW",
  "london bridge": "LBG",
};

function resolveCrs(name: string): string | undefined {
  return STATION_CRS[name.trim().toLowerCase()];
}

/** Parses one TrainPal ticket attachment's filename. Returns null if it doesn't match the expected pattern. */
export function parseTicketFilename(filename: string, yearHint: number): ParsedTicketLeg | null {
  const match = FILENAME_PATTERN.exec(filename);
  if (!match) return null;

  const [, fromName, toName, day, monAbbr, time] = match;
  const month = monAbbr ? MONTHS[monAbbr.toLowerCase()] : undefined;

  return {
    fromName,
    toName,
    fromCrs: resolveCrs(fromName),
    toCrs: resolveCrs(toName),
    bookedTime: time ? time.padStart(4, "0") : undefined,
    date: day && month ? `${yearHint}-${month}-${day.padStart(2, "0")}` : undefined,
  };
}

export interface CommuteTimesFromAttachments {
  date?: string;
  outboundTime?: string;
  returnTime?: string;
}

/**
 * Scans a set of TrainPal ticket filenames for legs matching the
 * configured commute (see `config/commute.ts`) and pulls out whatever
 * booked departure times it can find - an outbound leg from `fromCrs` to
 * `viaCrs`, and/or a return leg from `toCrs` to `viaCrs`. Legs without a
 * fixed time (an open return, as TrainPal "Anytime Return" tickets
 * typically are) simply won't contribute a time - that's expected, not an
 * error, and the caller should prefer any time the user typed themselves
 * over what this finds, since a booked time is a plan, not what actually
 * happened.
 */
export function findCommuteTimesFromAttachments(
  filenames: string[],
  yearHint: number,
): CommuteTimesFromAttachments {
  const legs = filenames
    .map((f) => parseTicketFilename(f, yearHint))
    .filter((l): l is ParsedTicketLeg => l !== null);

  const outboundLeg = legs.find((l) => l.fromCrs === COMMUTE.fromCrs && l.toCrs === COMMUTE.viaCrs);
  const returnLeg = legs.find((l) => l.fromCrs === COMMUTE.toCrs && l.toCrs === COMMUTE.viaCrs);

  return {
    date: outboundLeg?.date ?? returnLeg?.date,
    outboundTime: outboundLeg?.bookedTime,
    returnTime: returnLeg?.bookedTime,
  };
}
