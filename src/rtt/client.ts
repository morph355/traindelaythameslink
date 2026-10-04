import type { RttLocationSearchResponse, RttServiceDetailResponse } from "./types.js";

const BASE_URL = "https://data.rtt.io";

export interface RttCredentials {
  /** Bearer token from https://api-portal.rtt.io/ (the "next-gen" API - api.rtt.io/Basic Auth is retired). */
  token: string;
}

export class RttApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "RttApiError";
  }
}

export class RttClient {
  constructor(
    private readonly credentials: RttCredentials,
    private readonly baseUrl: string = BASE_URL,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async get<T>(path: string, params: Record<string, string | undefined>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }

    const response = await this.fetchImpl(url.toString(), {
      headers: { Authorization: `Bearer ${this.credentials.token}` },
    });
    if (!response.ok) {
      // RTT's error responses carry a body (usually JSON) explaining *why* -
      // e.g. an invalid token vs. a valid token with no active plan/subscription
      // for the gb-nr namespace. Without this, a 401 is a dead end to diagnose.
      const body = await response.text().catch(() => "");
      throw new RttApiError(
        `RTT API request to ${path} failed: ${response.status} ${response.statusText}${body ? ` - ${body}` : ""}`,
        response.status,
      );
    }
    return (await response.json()) as T;
  }

  /**
   * Passenger services departing `fromCrs` and subsequently calling at `toCrs`,
   * from `time` (HHmm, local UK clock time) for a 3-hour window.
   */
  async searchStationToStation(
    fromCrs: string,
    toCrs: string,
    date: Date,
    time: string,
  ): Promise<RttLocationSearchResponse> {
    return this.get<RttLocationSearchResponse>("/gb-nr/location", {
      code: fromCrs,
      filterTo: toCrs,
      timeFrom: isoLocalDateTime(date, time),
      timeWindow: "180",
    });
  }

  /** Full calling-point detail for one service, identified by its `identity` (not the full uniqueIdentity). */
  async getService(identity: string, date: Date): Promise<RttServiceDetailResponse> {
    return this.get<RttServiceDetailResponse>("/gb-nr/service", {
      identity,
      departureDate: isoDate(date),
    });
  }
}

function isoDate(date: Date): string {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * An ISO 8601 datetime with no timezone offset, for `date` at local clock
 * time `time` (HHmm) - the API treats an offset-less datetime as local time
 * at the queried location, which for GB stations is what we want without
 * having to reason about BST/GMT ourselves.
 */
function isoLocalDateTime(date: Date, time: string): string {
  const hh = time.slice(0, 2);
  const mm = time.slice(2, 4);
  return `${isoDate(date)}T${hh}:${mm}:00`;
}
