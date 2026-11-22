import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { clientIpResolver } from "../../src/infrastructure/client-ip.js";

async function resolve(trustProxy: boolean, forwardedFor?: string) {
  const app = new Hono();
  const resolver = clientIpResolver({ TRUST_PROXY: trustProxy }, () => "10.0.0.1");
  app.get("/", (c) => c.text(resolver(c) ?? "none"));
  const res = await app.request("/", { headers: forwardedFor ? { "X-Forwarded-For": forwardedFor } : {} });
  return res.text();
}

describe("clientIpResolver", () => {
  it("uses the socket address when no proxy is trusted (ignores spoofable headers)", async () => {
    expect(await resolve(false, "1.2.3.4")).toBe("10.0.0.1");
  });

  it("behind a trusted proxy, uses the last X-Forwarded-For entry (the one the proxy added)", async () => {
    expect(await resolve(true, "6.6.6.6, 203.0.113.7")).toBe("203.0.113.7");
    expect(await resolve(true, "203.0.113.7")).toBe("203.0.113.7");
  });

  it("falls back to the socket address if the header is missing", async () => {
    expect(await resolve(true)).toBe("10.0.0.1");
  });
});
