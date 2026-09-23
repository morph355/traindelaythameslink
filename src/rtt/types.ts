// Subset of the Realtime Trains API (https://api-portal.rtt.io/) JSON schema
// that this app actually uses. Times are HHmm 24h strings, minutes only.

export interface RttSearchLocationDetail {
  gbttBookedDeparture?: string;
  gbttBookedArrival?: string;
  realtimeDeparture?: string;
  realtimeArrival?: string;
  origin: Array<{ description: string; publicTime?: string }>;
  destination: Array<{ description: string; publicTime?: string }>;
}

export interface RttSearchService {
  serviceUid: string;
  runDate: string; // yyyy-MM-dd
  atocCode: string;
  atocName: string;
  trainIdentity?: string;
  serviceType: string;
  isPassenger: boolean;
  locationDetail: RttSearchLocationDetail;
}

export interface RttSearchResponse {
  location: { name: string; crs: string };
  services: RttSearchService[] | null;
}

export interface RttServiceLocation {
  crs: string;
  description: string;
  gbttBookedArrival?: string;
  gbttBookedDeparture?: string;
  realtimeArrival?: string;
  realtimeDeparture?: string;
  realtimeArrivalActual?: boolean;
  realtimeDepartureActual?: boolean;
  cancelled?: boolean;
  displayAs?: string;
}

export interface RttServiceResponse {
  serviceUid: string;
  runDate: string;
  atocCode: string;
  atocName: string;
  cancelReason?: string;
  locations: RttServiceLocation[];
}
