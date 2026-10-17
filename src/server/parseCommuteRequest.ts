import { DATE_PATTERN, TIME_PATTERN, ValidationError } from "./parseLegs.js";

export interface CommuteRequest {
  direction: "outbound" | "return";
  date: Date;
  bookedDepartureTime: string;
  /** Departure time (HHmm) of the train actually arrived on, if the booked one fell short. */
  tookDepartureTime?: string;
  /** One direct ticket for the whole direction instead of the split-save pair. */
  direct?: boolean;
}

export interface RawCommuteRequest {
  direction?: string;
  date?: string;
  time?: string;
  took?: string;
  direct?: boolean;
}

export function parseCommuteRequest(raw: RawCommuteRequest): CommuteRequest {
  const issues: string[] = [];

  if (raw.direction !== "outbound" && raw.direction !== "return") {
    issues.push('direction must be "outbound" or "return"');
  }

  const dateMatch = raw.date ? DATE_PATTERN.exec(raw.date) : null;
  if (!dateMatch) issues.push("date must be in yyyy-mm-dd format");

  const timeMatch = raw.time ? TIME_PATTERN.exec(raw.time) : null;
  if (!timeMatch) issues.push("time must be in HHmm or HH:mm format");

  const tookMatch = raw.took ? TIME_PATTERN.exec(raw.took) : null;
  if (raw.took && !tookMatch) issues.push("took must be in HHmm or HH:mm format");

  if (issues.length > 0) throw new ValidationError(issues);

  const [, yyyy, mm, dd] = dateMatch!;
  return {
    direction: raw.direction as "outbound" | "return",
    date: new Date(Number(yyyy), Number(mm) - 1, Number(dd)),
    bookedDepartureTime: `${timeMatch![1]}${timeMatch![2]}`,
    ...(tookMatch && { tookDepartureTime: `${tookMatch[1]}${tookMatch[2]}` }),
    ...(raw.direct === true && { direct: true }),
  };
}
