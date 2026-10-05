/**
 * Parses a plain-text email body describing a commute journey, e.g.:
 *
 *   out: 06:39
 *   back: 18:12
 *
 * Either line is optional (only the delay you hit), "return"/"inbound" are
 * accepted synonyms for "back", "outbound" for "out", and an optional
 * "date: yyyy-mm-dd" / "date: yesterday" line overrides the default of the
 * day the email was sent.
 */
export interface JourneyRequest {
  date: Date;
  /** True only if the email had an explicit "date:" line; otherwise `date` is just the day it was sent. */
  dateSpecified: boolean;
  outboundTime?: string;
  returnTime?: string;
  /**
   * Departure time (from the start of that direction's journey) of the train
   * actually arrived on, when the booked one was cancelled or terminated early.
   */
  outboundTook?: string;
  returnTook?: string;
}

export class JourneyRequestParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JourneyRequestParseError";
  }
}

export const FORMAT_HELP =
  'Send a time for each leg you travelled, one per line, e.g.:\n\n' +
  "out: 06:39\n" +
  "back: 18:12\n\n" +
  'Either line alone is fine if only one leg was delayed. Add "date: yyyy-mm-dd" ' +
  '(or "date: yesterday") if it wasn\'t today.\n\n' +
  "If your train was cancelled and you caught a later one, add the time that later " +
  'train left your starting station, e.g. "took: 18:30" (or "out took: 06:56" / ' +
  '"back took: 18:30" if you gave both out and back).';

const OUT_PATTERN = /\b(?:out|outbound)\b\s*[:\-]?\s*(\d{1,2}[:.]?\d{2})/i;
const BACK_PATTERN = /\b(?:back|return|inbound)\b\s*[:\-]?\s*(\d{1,2}[:.]?\d{2})/i;
const TIME = String.raw`(\d{1,2}[:.]?\d{2})`;
const OUT_TOOK_PATTERN = new RegExp(String.raw`\b(?:out|outbound)\s+took\b\s*[:\-]?\s*${TIME}`, "i");
const BACK_TOOK_PATTERN = new RegExp(String.raw`\b(?:back|return|inbound)\s+took\b\s*[:\-]?\s*${TIME}`, "i");
const TOOK_PATTERN = new RegExp(String.raw`\btook\b\s*[:\-]?\s*${TIME}`, "i");
const DATE_PATTERN = /\bdate\b\s*[:\-]?\s*(\d{4}-\d{2}-\d{2}|today|yesterday)\b/i;

function normalizeTime(raw: string): string {
  return raw.replace(/[:.]/g, "").padStart(4, "0");
}

function resolveDate(token: string | undefined, receivedAt: Date): Date {
  const base = new Date(receivedAt.getFullYear(), receivedAt.getMonth(), receivedAt.getDate());
  if (!token || token.toLowerCase() === "today") return base;
  if (token.toLowerCase() === "yesterday") {
    base.setDate(base.getDate() - 1);
    return base;
  }
  const [y, m, d] = token.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function tookTime(raw: string | undefined): string | undefined {
  return raw ? normalizeTime(raw) : undefined;
}

export function parseJourneyRequest(body: string, receivedAt: Date): JourneyRequest {
  const outMatch = OUT_PATTERN.exec(body);
  const backMatch = BACK_PATTERN.exec(body);

  if (!outMatch && !backMatch) {
    throw new JourneyRequestParseError(FORMAT_HELP);
  }

  const dateMatch = DATE_PATTERN.exec(body);

  // "took:" says which train you actually arrived on after yours was cancelled.
  // Direction-specific forms always work; a bare "took:" is only unambiguous
  // when exactly one of out/back was given, so it is ignored otherwise.
  const outTook = OUT_TOOK_PATTERN.exec(body)?.[1];
  const backTook = BACK_TOOK_PATTERN.exec(body)?.[1];
  const bareTook = TOOK_PATTERN.exec(body.replace(OUT_TOOK_PATTERN, "").replace(BACK_TOOK_PATTERN, ""))?.[1];
  const onlyOut = outMatch && !backMatch;
  const onlyBack = backMatch && !outMatch;

  return {
    date: resolveDate(dateMatch?.[1], receivedAt),
    dateSpecified: dateMatch !== null,
    outboundTime: outMatch ? normalizeTime(outMatch[1]) : undefined,
    returnTime: backMatch ? normalizeTime(backMatch[1]) : undefined,
    outboundTook: tookTime(outTook ?? (onlyOut ? bareTook : undefined)),
    returnTook: tookTime(backTook ?? (onlyBack ? bareTook : undefined)),
  };
}
