import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { basicAuth } from "../../src/server/basicAuth.js";

function appWithAuth() {
  const app = express();
  app.use(basicAuth("alice", "s3cret"));
  app.get("/", (_req, res) => res.send("ok"));
  return app;
}

function authHeader(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

describe("basicAuth", () => {
  it("rejects a request with no credentials", async () => {
    const response = await request(appWithAuth()).get("/");
    expect(response.status).toBe(401);
    expect(response.headers["www-authenticate"]).toMatch(/^Basic/);
  });

  it("rejects wrong credentials", async () => {
    const response = await request(appWithAuth())
      .get("/")
      .set("Authorization", authHeader("alice", "wrong"));
    expect(response.status).toBe(401);
  });

  it("rejects a malformed Authorization header", async () => {
    const response = await request(appWithAuth()).get("/").set("Authorization", "Bearer whatever");
    expect(response.status).toBe(401);
  });

  it("allows the correct credentials through", async () => {
    const response = await request(appWithAuth())
      .get("/")
      .set("Authorization", authHeader("alice", "s3cret"));
    expect(response.status).toBe(200);
    expect(response.text).toBe("ok");
  });
});
