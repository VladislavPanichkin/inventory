import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { csrfProtection } from "../../src/common/csrf.js";

function app() {
  const hono = new Hono();
  hono.use("*", csrfProtection({ allowedOrigins: ["http://localhost:5173"], exemptPrefixes: ["/webhooks/"] }));
  hono.all("*", (c) => c.text("ok"));
  return hono;
}

describe("csrfProtection", () => {
  it("lets safe methods through", async () => {
    expect((await app().request("http://api.test/x")).status).toBe(200);
  });

  it("requires the X-Requested-With header on unsafe methods", async () => {
    expect((await app().request("http://api.test/x", { method: "POST" })).status).toBe(403);
    expect((await app().request("http://api.test/x", { method: "DELETE" })).status).toBe(403);
    const ok = await app().request("http://api.test/x", { method: "POST", headers: { "X-Requested-With": "fetch" } });
    expect(ok.status).toBe(200);
  });

  it("rejects foreign origins even with the header", async () => {
    const res = await app().request("http://api.test/x", {
      method: "PATCH",
      headers: { "X-Requested-With": "fetch", Origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
  });

  it("accepts the configured frontend origin and the API's own origin", async () => {
    for (const origin of ["http://localhost:5173", "http://api.test"]) {
      const res = await app().request("http://api.test/x", {
        method: "POST",
        headers: { "X-Requested-With": "fetch", Origin: origin },
      });
      expect(res.status, origin).toBe(200);
    }
  });

  it("skips exempt prefixes (signature-verified webhooks)", async () => {
    expect((await app().request("http://api.test/webhooks/ebay", { method: "POST" })).status).toBe(200);
  });
});
