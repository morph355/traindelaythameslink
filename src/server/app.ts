import express, { type Express } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { basicAuth } from "./basicAuth.js";
import { COMMUTE } from "../config/commute.js";
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
      throw err;
    }

    const outbound = request.direction === "outbound";
    const spec = {
      fromCrs: outbound ? COMMUTE.fromCrs : COMMUTE.toCrs,
      viaCrs: COMMUTE.viaCrs,
      toCrs: outbound ? COMMUTE.toCrs : COMMUTE.fromCrs,
      date: request.date,
      bookedDepartureTime: request.bookedDepartureTime,
      ticketLabels: outbound
        ? { leg1: COMMUTE.ticketLabels.outboundLeg1, leg2: COMMUTE.ticketLabels.outboundLeg2 }
        : { leg1: COMMUTE.ticketLabels.returnLeg1, leg2: COMMUTE.ticketLabels.returnLeg2 },
    };

    try {
      const results = await checkSplitJourney(client, spec);
      res.json({ results });
    } catch (err) {
      if (err instanceof NoMatchingServiceError) {
        return res.status(404).json({ error: err.message });
      }
      throw err;
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
      throw err;
    }

    try {
      const results = await Promise.all(legs.map((leg) => checkLeg(client, leg)));
      res.json({ results });
    } catch (err) {
      if (err instanceof NoMatchingServiceError) {
        return res.status(404).json({ error: err.message });
      }
      throw err;
    }
  });

  return app;
}
