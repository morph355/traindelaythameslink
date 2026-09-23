import express, { type Express } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RttClient } from "../rtt/client.js";
import { NoMatchingServiceError, checkLeg } from "../rtt/checkLeg.js";
import { ValidationError, parseLegs, type RawLegInput } from "./parseLegs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "..", "public");

export function createApp(client: RttClient): Express {
  const app = express();
  app.use(express.json());
  app.use(express.static(PUBLIC_DIR));

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
