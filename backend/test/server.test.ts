import { describe, expect, it } from "vitest";
import { buildApp } from "../src/server.js";

describe("health", () => {
  it("returns ok + runtime ts", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", runtime: "ts" });
    await app.close();
  });
});
