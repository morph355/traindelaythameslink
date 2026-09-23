import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

const REALM = 'Basic realm="Thameslink Delay Repay checker"';

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** HTTP Basic Auth gate - required whenever this app is reachable from outside the LAN. */
export function basicAuth(username: string, password: string): RequestHandler {
  return (req, res, next) => {
    const header = req.headers.authorization;
    if (header?.startsWith("Basic ")) {
      const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8");
      const sep = decoded.indexOf(":");
      if (sep !== -1) {
        const user = decoded.slice(0, sep);
        const pass = decoded.slice(sep + 1);
        if (safeEqual(user, username) && safeEqual(pass, password)) {
          return next();
        }
      }
    }
    res.set("WWW-Authenticate", REALM);
    res.status(401).send("Authentication required");
  };
}
