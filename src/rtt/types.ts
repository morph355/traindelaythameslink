// Subset of the Realtime Trains "next-gen" API
// (https://github.com/realtimetrains/api-specification, data.rtt.io)
// that this app actually uses. All times are ISO 8601 datetimes.

export interface RttGeographicLocation {
  namespace?: string;
  description?: string;
  /** Short (CRS-like, e.g. "BTN") codes for this location. */
  shortCodes?: string[];
  /** Long (TIPLOC-like) codes for this location. */
  longCodes?: string[];
}

export interface RttIndividualTemporalData {
  scheduleAdvertised?: string;
  realtimeForecast?: string;
  realtimeEstimate?: string;
  realtimeNoReport?: boolean;
  realtimeActual?: string;
  realtimeAdvertisedLateness?: number;
  isCancelled?: boolean;
}

export interface RttLocationTemporalData {
  arrival?: RttIndividualTemporalData;
  departure?: RttIndividualTemporalData;
  pass?: RttIndividualTemporalData;
}

export interface RttScheduleMetadata {
  uniqueIdentity: string;
  namespace: string;
  identity: string;
  /** yyyy-mm-dd */
  departureDate: string;
  inPassengerService?: boolean;
  modeType?: string;
}

export interface RttLocationLineUpItem {
  scheduleMetadata: RttScheduleMetadata;
  temporalData?: RttLocationTemporalData;
}

export interface RttLocationSearchResponse {
  services?: RttLocationLineUpItem[];
}

export interface RttServiceLocationEntry {
  temporalData?: RttLocationTemporalData;
  location?: RttGeographicLocation;
}

export interface RttServiceDetailResponse {
  service?: {
    scheduleMetadata: RttScheduleMetadata;
    locations: RttServiceLocationEntry[];
  };
}
