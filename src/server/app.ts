import express, { type Express, type ErrorRequestHandler } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { basicAuth } from "./basicAuth.js";
import { COMMUTE, buildCommuteJourneySpec } from "../config/commute.js";
import type { RttClient } from "../rtt/client.js";
import { NoMatchingServiceError, checkLeg } from "../rtt/checkLeg.js";
import { checkSplitJourney } from "../rtt/checkSplitJourney.js";
import { parseCommuteRequest, type RawCommuteRequest } from "./parseCommuteRequest.js";
import { ValidationError, parseLegs, type RawLegInput } from "./parseLegs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "..", "public");

export interface CreateAppOptions {
  /** When set, every route requires this HTTP Basic Auth login. Required if the app is reachable outside your LAN. */
  auth?: { username: string; password: string };
}

export function createApp(client: RttClient, options: CreateAppOptions = {}): Express {
  const app = express();
  if (options.auth) {
    app.use(basicAuth(options.auth.username, options.auth.password));
  }
  app.use(express.json());
  app.use(express.static(PUBLIC_DIR));

  app.get("/api/commute", (_req, res) => {
    res.json(COMMUTE);
  });

  app.post("/api/check-commute", async (req, res) => {
    let request;
    try {
      request = parseCommuteRequest((req.body ?? {}) as RawCommuteRequest);
    } catch (err) {
      if (err instanceof ValidationError) {
        return res.status(400).json({ issues: err.issues });
      }
      console.error("POST /api/check-commute failed to parse request:", err);
      return res.status(500).json({ error: "Something went wrong handling that request." });
    }

    const spec = buildCommuteJourneySpec(request.direction, request.date, request.bookedDepartureTime);

    try {
      const results = await checkSplitJourney(client, spec);
      res.json({ results });
    } catch (err) {
      if (err instanceof NoMatchingServiceError) {
        return res.status(404).json({ error: err.message });
      }
      console.error("POST /api/check-commute failed:", err);
      return res.status(502).json({ error: "Couldn't fetch train data. Try again shortly." });
    }
  });

  app.post("/api/check", async (req, res) => {
    const rawLegs: RawLegInput[] = Array.isArray(req.body?.legs) ? req.body.legs : [];

    let legs;
    try {
      legs = parseLegs(rawLegs);
    } catch (err) {
      if (err instanceof ValidationError) {
        return res.status(400).json({ issues: err.issues });
      }
      console.error("POST /api/check failed to parse request:", err);
      return res.status(500).json({ error: "Something went wrong handling that request." });
    }

    try {
      const results = await Promise.all(legs.map((leg) => checkLeg(client, leg)));
      res.json({ results });
    } catch (err) {
      if (err instanceof NoMatchingServiceError) {
        return res.status(404).json({ error: err.message });
      }
      console.error("POST /api/check failed:", err);
      return res.status(502).json({ error: "Couldn't fetch train data. Try again shortly." });
    }
  });

  // Last-resort safety net: Express 4 doesn't catch rejected promises from
  // async handlers on its own, so any route that forgets its own try/catch
  // would otherwise crash the whole process instead of returning an error.
  const handleError: ErrorRequestHandler = (err, _req, res, _next) => {
    console.error("Unhandled error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Something went wrong." });
    }
  };
  app.use(handleError);

  return app;
}
