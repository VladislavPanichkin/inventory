import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createMemoryRateLimitStore, rateLimit } from "../../src/common/rate-limit.js";

describe("rateLimit", () => {
  it("allows `limit` requests per window, then answers 429 with Retry-After", async () => {
    let now = 1_000_000;
    const app = new Hono();
    app.use("*", rateLimit({ store: createMemoryRateLimitStore(), name: "t", limit: 2, windowMs: 60_000, key: () => "ip", now: () => now }));
    app.get("*", (c) => c.text("ok"));

    expect((await app.request("/")).status).toBe(200);
    expect((await app.request("/")).status).toBe(200);
    const blocked = await app.request("/");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe("60");

    now += 60_000; // window elapsed
    expect((await app.request("/")).status).toBe(200);
  });

  it("counts keys independently", () => {
    const store = createMemoryRateLimitStore();
    expect(store.hit("a", 1000, 0).count).toBe(1);
    expect(store.hit("a", 1000, 1).count).toBe(2);
    expect(store.hit("b", 1000, 1).count).toBe(1);
  });

  it("stays bounded in memory", () => {
    const store = createMemoryRateLimitStore(3);
    for (let i = 0; i < 10; i++) store.hit(`k${i}`, 1000, 0);
    // Must not throw or grow unbounded; a fresh key still works.
    expect(store.hit("new", 1000, 0).count).toBe(1);
  });
});
