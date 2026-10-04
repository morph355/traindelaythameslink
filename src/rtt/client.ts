import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
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

/**
 * Responses for journeys on a past date are final, so they're kept for a day:
 * if a rate limit stretches one email's checks over hours, the retry only
 * pays for the calls that never succeeded. Today's/future data can still
 * change (a train with no actual arrival yet), so it's only kept briefly.
 */
const CACHE_TTL_PAST_MS = 24 * 60 * 60 * 1000;
const CACHE_TTL_CURRENT_MS = 60 * 60 * 1000;

interface CacheEntry {
  expiresAt: number;
  data: unknown;
}

export interface RttClientOptions {
  /** If set, the response cache is loaded from / saved to this JSON file so it survives restarts. */
  cacheFile?: string;
}

const MAX_ACTIVITY_ENTRIES = 40;

export interface RttActivityEntry {
  /** epoch ms */
  at: number;
  message: string;
}

export interface RttStatus {
  requestsLastMinute: number;
  limitPerMinute: number;
  /** epoch ms until which requests are paused (throttle or RTT 429), if currently waiting */
  pausedUntil?: number;
  /** Most recent x-ratelimit-remaining-* values RTT reported. */
  rateLimitRemaining: { minute?: number; hour?: number; day?: number };
  recent: RttActivityEntry[];
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
  private requestTimes: number[] = [];
  private activity: RttActivityEntry[] = [];
  private pausedUntil: number | undefined;
  private rateLimitRemaining: RttStatus["rateLimitRemaining"] = {};
  private slotChain: Promise<void> = Promise.resolve();
  private cachedAccessToken: { token: string; expiresAtMs: number } | undefined;

  constructor(
    private readonly credentials: RttCredentials,
    private readonly baseUrl: string = BASE_URL,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
    private readonly options: RttClientOptions = {},
  ) {
    this.loadCache();
  }

  private cache = new Map<string, CacheEntry>();

  private loadCache(): void {
    if (!this.options.cacheFile) return;
    try {
      const entries = JSON.parse(readFileSync(this.options.cacheFile, "utf8")) as [string, CacheEntry][];
      const now = Date.now();
      for (const [key, entry] of entries) {
        if (entry.expiresAt > now) this.cache.set(key, entry);
      }
    } catch {
      // No cache file yet, or it's unreadable - start empty.
    }
  }

  private saveCache(): void {
    if (!this.options.cacheFile) return;
    try {
      const now = Date.now();
      for (const [key, entry] of this.cache) if (entry.expiresAt <= now) this.cache.delete(key);
      mkdirSync(path.dirname(this.options.cacheFile), { recursive: true });
      writeFileSync(this.options.cacheFile, JSON.stringify([...this.cache]));
    } catch (err) {
      this.log(`Couldn't save response cache: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Exchanges the long-life refresh token for a short-life access token,
   * reusing the cached one until shortly before it expires.
   */
  private async getAccessToken(): Promise<string> {
    if (this.cachedAccessToken && this.cachedAccessToken.expiresAtMs > Date.now()) {
      return this.cachedAccessToken.token;
    }

    this.log("Exchanging refresh token for an access token");
    const response = await this.fetchImpl(`${this.baseUrl}/api/get_access_token`, {
      headers: { Authorization: `Bearer ${this.credentials.token}` },
    });
    this.log(`Token exchange -> ${response.status}`);
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

  /** What the client has been doing lately, for display on the page. */
  getStatus(): RttStatus {
    const now = Date.now();
    return {
      requestsLastMinute: this.requestTimes.filter((t) => now - t < WINDOW_MS).length,
      limitPerMinute: MAX_REQUESTS_PER_MINUTE,
      pausedUntil: this.pausedUntil && this.pausedUntil > now ? this.pausedUntil : undefined,
      rateLimitRemaining: { ...this.rateLimitRemaining },
      recent: [...this.activity],
    };
  }

  private log(message: string): void {
    this.activity.push({ at: Date.now(), message });
    if (this.activity.length > MAX_ACTIVITY_ENTRIES) this.activity.shift();
  }

  private async pause(ms: number, reason: string): Promise<void> {
    this.pausedUntil = Date.now() + ms;
    this.log(`${reason} - waiting ${Math.ceil(ms / 1000)}s`);
    await this.sleep(ms);
    this.pausedUntil = undefined;
  }

  private recordRateLimit(response: Response): void {
    const read = (name: string) => {
      const value = Number(response.headers?.get(name));
      return response.headers?.get(name) == null || !Number.isFinite(value) ? undefined : value;
    };
    this.rateLimitRemaining = {
      minute: read("x-ratelimit-remaining-minute"),
      hour: read("x-ratelimit-remaining-hour"),
      day: read("x-ratelimit-remaining-day"),
    };
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
        await this.pause(
          this.requestTimes[0] + WINDOW_MS - now + 250,
          `Pacing: ${this.requestTimes.length} requests in the last minute (limit ${MAX_REQUESTS_PER_MINUTE})`,
        );
      }
      this.requestTimes.push(Date.now());
    } finally {
      release();
    }
  }

  private async get<T>(urlPath: string, params: Record<string, string | undefined>): Promise<T> {
    const url = new URL(`${this.baseUrl}${urlPath}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }

    const cacheKey = url.pathname + url.search;
    const label = `${urlPath} ${url.searchParams.get("code") ?? url.searchParams.get("identity") ?? ""}`.trim();
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      this.log(`${label} -> cached (no RTT call used)`);
      return cached.data as T;
    }
    const accessToken = await this.getAccessToken();
    const send = async (): Promise<Response> => {
      await this.acquireSlot();
      this.log(`Requesting ${label}`);
      const res = await this.fetchImpl(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      this.recordRateLimit(res);
      this.log(`${label} -> ${res.status}`);
      return res;
    };
    let response = await send();
    for (let attempt = 0; response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES; attempt++) {
      const retryAfterSeconds = Number(response.headers?.get("retry-after"));
      const waitMs = (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds : 15) * 1000 + 500;
      if (waitMs > MAX_RETRY_WAIT_MS) {
        // Hourly/daily allowance exhausted: waiting here would just hang the request.
        this.log(
          `RTT rate limit exhausted (remaining: ${this.rateLimitRemaining.minute ?? "?"}/min, ` +
            `${this.rateLimitRemaining.hour ?? "?"}/hour, ${this.rateLimitRemaining.day ?? "?"}/day) - ` +
            `resets in about ${Math.ceil(retryAfterSeconds / 60)} min, not retrying`,
        );
        break;
      }
      await this.pause(waitMs, `RTT says rate limit exceeded (retry ${attempt + 1}/${MAX_RATE_LIMIT_RETRIES})`);
      response = await send();
    }
    if (!response.ok) {
      // RTT's error responses carry a body (usually JSON) explaining *why* -
      // e.g. an invalid token vs. a valid token with no active plan/subscription
      // for the gb-nr namespace. Without this, a 401 is a dead end to diagnose.
      const body = await response.text().catch(() => "");
      throw new RttApiError(
        `RTT API request to ${urlPath} failed: ${response.status} ${response.statusText}${body ? ` - ${body}` : ""}`,
        response.status,
      );
    }
    const data = (await response.json()) as T;
    this.cache.set(cacheKey, { expiresAt: Date.now() + cacheTtlMs(url), data });
    this.saveCache();
    return data;
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

/** The journey date a request is for: `departureDate` (service) or the date part of `timeFrom` (location). */
function requestDate(url: URL): string | undefined {
  return url.searchParams.get("departureDate") ?? url.searchParams.get("timeFrom")?.slice(0, 10) ?? undefined;
}

function cacheTtlMs(url: URL): number {
  const date = requestDate(url);
  return date !== undefined && date < isoDate(new Date()) ? CACHE_TTL_PAST_MS : CACHE_TTL_CURRENT_MS;
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
