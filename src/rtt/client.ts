import type { RttLocationSearchResponse, RttServiceDetailResponse } from "./types.js";

const BASE_URL = "https://data.rtt.io";

export interface RttCredentials {
  /**
   * The token shown on https://api-portal.rtt.io/'s dashboard. For a
   * personal-use account this is a long-life *refresh* token, not usable
   * directly against /gb-nr/* - it must first be exchanged for a short-life
   * access token via GET /api/get_access_token (the dashboard's own label,
   * "use the following token to request an access token", says as much).
   * RttClient does that exchange itself and caches the result.
   */
  token: string;
}

interface AccessTokenResponse {
  token: string;
  validUntil: string;
}

/** RTT allows ~10 requests/minute, so a 429 is routine: wait out Retry-After and retry. */
const MAX_RATE_LIMIT_RETRIES = 2;
const MAX_RETRY_WAIT_MS = 65_000;
/** Stay just under RTT's 10/minute limit, shared by every caller of this client (web + email poller). */
const MAX_REQUESTS_PER_MINUTE = 9;
const WINDOW_MS = 60_000;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
  private requestTimes: number[] = [];
  private slotChain: Promise<void> = Promise.resolve();
  private cachedAccessToken: { token: string; expiresAtMs: number } | undefined;

  constructor(
    private readonly credentials: RttCredentials,
    private readonly baseUrl: string = BASE_URL,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
  ) {}

  /**
   * Exchanges the long-life refresh token for a short-life access token,
   * reusing the cached one until shortly before it expires.
   */
  private async getAccessToken(): Promise<string> {
    if (this.cachedAccessToken && this.cachedAccessToken.expiresAtMs > Date.now()) {
      return this.cachedAccessToken.token;
    }

    const response = await this.fetchImpl(`${this.baseUrl}/api/get_access_token`, {
      headers: { Authorization: `Bearer ${this.credentials.token}` },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new RttApiError(
        `RTT API request to /api/get_access_token failed: ${response.status} ${response.statusText}${body ? ` - ${body}` : ""}`,
        response.status,
      );
    }
    const data = (await response.json()) as AccessTokenResponse;
    // Refresh 30s early so a request never races an expiring token.
    const expiresAtMs = new Date(data.validUntil).getTime() - 30_000;
    this.cachedAccessToken = { token: data.token, expiresAtMs };
    return data.token;
  }

  /** Waits (in call order) until a request can be made without exceeding the per-minute limit. */
  private async acquireSlot(): Promise<void> {
    const previous = this.slotChain;
    let release!: () => void;
    this.slotChain = new Promise<void>((resolve) => (release = resolve));
    await previous;
    try {
      for (;;) {
        const now = Date.now();
        this.requestTimes = this.requestTimes.filter((t) => now - t < WINDOW_MS);
        if (this.requestTimes.length < MAX_REQUESTS_PER_MINUTE) break;
        await this.sleep(this.requestTimes[0] + WINDOW_MS - now + 250);
      }
      this.requestTimes.push(Date.now());
    } finally {
      release();
    }
  }

  private async get<T>(path: string, params: Record<string, string | undefined>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }

    const accessToken = await this.getAccessToken();
    await this.acquireSlot();
    let response = await this.fetchImpl(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    for (let attempt = 0; response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES; attempt++) {
      const retryAfterSeconds = Number(response.headers?.get("retry-after"));
      const waitMs = Math.min(
        (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds : 15) * 1000 + 500,
        MAX_RETRY_WAIT_MS,
      );
      await this.sleep(waitMs);
      await this.acquireSlot();
      response = await this.fetchImpl(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    }
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
