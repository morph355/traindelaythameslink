import type { RttSearchResponse, RttServiceResponse } from "./types.js";

const BASE_URL = "https://api.rtt.io/api/v1";

export interface RttCredentials {
  username: string;
  password: string;
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

  private authHeader(): string {
    const token = Buffer.from(
      `${this.credentials.username}:${this.credentials.password}`,
    ).toString("base64");
    return `Basic ${token}`;
  }

  private async get<T>(path: string): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      headers: { Authorization: this.authHeader() },
    });
    if (!response.ok) {
      throw new RttApiError(
        `RTT API request to ${path} failed: ${response.status} ${response.statusText}`,
        response.status,
      );
    }
    return (await response.json()) as T;
  }

  /**
   * Services running from `fromCrs` to `toCrs` on `date`, optionally from `time` (HHmm) onwards.
   */
  async searchStationToStation(
    fromCrs: string,
    toCrs: string,
    date: Date,
    time?: string,
  ): Promise<RttSearchResponse> {
    const { yyyy, mm, dd } = datePathParts(date);
    const timeSegment = time ? `/${time}` : "";
    return this.get<RttSearchResponse>(
      `/json/search/${fromCrs}/to/${toCrs}/${yyyy}/${mm}/${dd}${timeSegment}`,
    );
  }

  async getService(serviceUid: string, date: Date): Promise<RttServiceResponse> {
    const { yyyy, mm, dd } = datePathParts(date);
    return this.get<RttServiceResponse>(`/json/service/${serviceUid}/${yyyy}/${mm}/${dd}`);
  }
}

function datePathParts(date: Date): { yyyy: string; mm: string; dd: string } {
  return {
    yyyy: String(date.getFullYear()),
    mm: String(date.getMonth() + 1).padStart(2, "0"),
    dd: String(date.getDate()).padStart(2, "0"),
  };
}
