import type { Leg } from "../engine/types.js";

export interface RawLegInput {
  fromCrs?: string;
  toCrs?: string;
  /** yyyy-mm-dd */
  date?: string;
  /** HHmm or HH:mm */
  bookedDepartureTime?: string;
  ticketLabel?: string;
}

export class ValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid journey input: ${issues.join("; ")}`);
    this.name = "ValidationError";
  }
}

export const CRS_PATTERN = /^[A-Za-z]{3}$/;
export const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
export const TIME_PATTERN = /^(\d{2}):?(\d{2})$/;

function parseOneLeg(raw: RawLegInput, index: number, issues: string[]): Leg | undefined {
  const label = `Leg ${index + 1}`;

  if (!raw.fromCrs || !CRS_PATTERN.test(raw.fromCrs)) {
    issues.push(`${label}: "from" must be a 3-letter station CRS code`);
  }
  if (!raw.toCrs || !CRS_PATTERN.test(raw.toCrs)) {
    issues.push(`${label}: "to" must be a 3-letter station CRS code`);
  }

  const dateMatch = raw.date ? DATE_PATTERN.exec(raw.date) : null;
  if (!dateMatch) {
    issues.push(`${label}: date must be in yyyy-mm-dd format`);
  }

  const timeMatch = raw.bookedDepartureTime ? TIME_PATTERN.exec(raw.bookedDepartureTime) : null;
  if (!timeMatch) {
    issues.push(`${label}: booked departure time must be in HHmm or HH:mm format`);
  }

  if (!dateMatch || !timeMatch || issues.some((i) => i.startsWith(label))) return undefined;

  const [, yyyy, mm, dd] = dateMatch;
  return {
    fromCrs: raw.fromCrs!.toUpperCase(),
    toCrs: raw.toCrs!.toUpperCase(),
    date: new Date(Number(yyyy), Number(mm) - 1, Number(dd)),
    bookedDepartureTime: `${timeMatch[1]}${timeMatch[2]}`,
    ticketLabel: raw.ticketLabel?.trim() || undefined,
  };
}

/** Parses and validates one or more journey legs, throwing ValidationError listing every problem found. */
export function parseLegs(rawLegs: RawLegInput[]): Leg[] {
  if (rawLegs.length === 0) {
    throw new ValidationError(["At least one leg is required"]);
  }

  const issues: string[] = [];
  const legs = rawLegs.map((raw, i) => parseOneLeg(raw, i, issues));

  if (issues.length > 0) {
    throw new ValidationError(issues);
  }

  return legs as Leg[];
}
