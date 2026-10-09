/** A single ticket leg of a journey (a split-save journey has one of these per ticket). */
export interface Leg {
  fromCrs: string;
  toCrs: string;
  /** Journey date. */
  date: Date;
  /** Booked/intended departure time, HHmm 24h, e.g. "0812". */
  bookedDepartureTime: string;
  /** Free-text label for the ticket, e.g. "Off-Peak Single St Pancras-Brighton". */
  ticketLabel?: string;
}

/** Actual (or best-known) performance of one service between two stations. */
export interface ServicePerformance {
  serviceUid: string;
  runDate: string;
  scheduledDeparture?: string;
  scheduledArrival?: string;
  /** Realtime arrival at the destination, HHmm. Undefined if not yet reported. */
  actualArrival?: string;
  /** Whether `actualArrival` is a confirmed actual (vs a live estimate). */
  arrivalIsActual: boolean;
  cancelled: boolean;
  /** Booked and actual departure (HHmm) at the start of this leg, not the service's origin. */
  legScheduledDeparture?: string;
  legActualDeparture?: string;
  /** Delay/cancellation reason published by RTT, e.g. "train fault - a problem with the brakes". */
  delayReason?: string;
  /**
   * Set when this is the train the passenger actually arrived on instead of
   * their booked one: the booked service's uid. `scheduledArrival` is still
   * the booked service's, since that's what Delay Repay measures against.
   */
  replacesServiceUid?: string;
}

export interface CompensationTier {
  eligible: boolean;
  label: string;
  /** Percentage of the fare for this ticket, per the standard Delay Repay 15 scheme. */
  percentOfFare: number;
}

export interface AlternativesSummary {
  checkedCount: number;
  fasterAlternativeFound: boolean;
  bestAlternativeArrival?: string;
  minutesEarlierThanTaken?: number;
  lines: string[];
}

export interface LegResult {
  leg: Leg;
  taken: ServicePerformance;
  delayMinutes: number;
  compensation: CompensationTier;
  alternatives: AlternativesSummary;
}
