import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createLogger } from "../../src/common/logger.js";
import { loadConfig } from "../../src/config/env.js";
import type { Database } from "../../src/infrastructure/database.js";
import { createMemoryImageStorage } from "../../src/infrastructure/image-storage.js";

const silentLogger = createLogger({ sink: () => {} });
const config = loadConfig({ DATABASE_URL: "postgresql://unused", NODE_ENV: "test" });
const fixedNow = () => new Date("2026-01-01T00:00:00.000Z");

function fakeDb(ok: boolean): Database {
  return {
    $queryRaw: async () => {
      if (!ok) throw new Error("connect ECONNREFUSED 127.0.0.1:5432 password=hunter2");
      return [{ "?column?": 1 }];
    },
  } as unknown as Database;
}

describe("GET /api/v1/health", () => {
  it("returns 200 with the standard data envelope when the database is up", async () => {
    const app = createApp({ config, db: fakeDb(true), logger: silentLogger, imageStorage: createMemoryImageStorage(), now: fixedNow });
    const res = await app.request("/api/v1/health");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      data: {
        status: "ok",
        environment: "test",
        timestamp: "2026-01-01T00:00:00.000Z",
        checks: { database: { status: "up" }, ebayCredentials: { status: "missing" } },
      },
    });
  });

  it("returns 503 without leaking the underlying error when the database is down", async () => {
    const app = createApp({ config, db: fakeDb(false), logger: silentLogger, imageStorage: createMemoryImageStorage() });
    const res = await app.request("/api/v1/health");

    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).toContain('"status":"degraded"');
    expect(text).not.toContain("ECONNREFUSED");
    expect(text).not.toContain("hunter2");
  });
});

describe("app behaviour", () => {
  const app = createApp({ config, db: fakeDb(true), logger: silentLogger, imageStorage: createMemoryImageStorage() });

  it("returns 404 with the error envelope outside the API", async () => {
    const res = await app.request("/does-not-exist");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; requestId?: string } };
    expect(body.error.code).toBe("NOT_FOUND");
    expect(typeof body.error.requestId).toBe("string");
  });

  it("is deny-by-default: unknown and protected API routes need a session", async () => {
    for (const path of ["/api/v1/does-not-exist", "/api/v1/products", "/api/v1/sales", "/api/v1/dashboard/summary", "/api/v1/auth/me"]) {
      const res = await app.request(path);
      expect(res.status, path).toBe(401);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("UNAUTHORIZED");
    }
  });

  it("rejects mutating requests without the CSRF header before authentication", async () => {
    const res = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@b.c", password: "x" }),
    });
    expect(res.status).toBe(403);
  });

  it("allows CORS only for the configured frontend origin, with credentials", async () => {
    const allowed = await app.request("/api/v1/health", { headers: { Origin: "http://localhost:5173" } });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(allowed.headers.get("access-control-allow-credentials")).toBe("true");

    const other = await app.request("/api/v1/health", { headers: { Origin: "https://evil.example" } });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("sets security headers", async () => {
    const res = await app.request("/api/v1/health");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });

  it("publishes an OpenAPI document outside production", async () => {
    const res = await app.request("/api/v1/openapi.json");
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    for (const path of [
      "/api/v1/health",
      "/api/v1/auth/login",
      "/api/v1/products",
      "/api/v1/products/{id}",
      "/api/v1/products/{id}/status",
      "/api/v1/products/{id}/status-history",
      "/api/v1/products/{id}/sales",
      "/api/v1/sales",
      "/api/v1/sales/{id}",
      "/api/v1/dashboard/summary",
    ]) {
      expect(doc.paths, path).toHaveProperty([path]);
    }
  });

  it("does not expose API docs in production", async () => {
    const prodConfig = loadConfig({
      DATABASE_URL: "postgresql://unused",
      NODE_ENV: "production",
      TOKEN_ENCRYPTION_KEY: btoa("x".repeat(32)),
      FRONTEND_URL: "https://inventory.example.com",
      IMAGE_STORAGE: "local",
    });
    const prodApp = createApp({ config: prodConfig, db: fakeDb(true), logger: silentLogger, imageStorage: createMemoryImageStorage() });
    // Not public in production: the auth guard answers before any route would.
    expect((await prodApp.request("/api/v1/openapi.json")).status).toBe(401);
    expect((await prodApp.request("/api/v1/docs")).status).toBe(401);
  });
});
