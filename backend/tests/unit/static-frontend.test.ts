import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createLogger } from "../../src/common/logger.js";
import { loadConfig } from "../../src/config/env.js";
import type { Database } from "../../src/infrastructure/database.js";
import { createMemoryImageStorage } from "../../src/infrastructure/image-storage.js";
import { attachFrontend, cacheControlFor } from "../../src/infrastructure/static-frontend.js";

let dist: string;

beforeAll(() => {
  dist = mkdtempSync(path.join(tmpdir(), "inventory-dist-"));
  mkdirSync(path.join(dist, "assets"));
  writeFileSync(path.join(dist, "index.html"), "<!doctype html><title>Inventory Admin</title>");
  writeFileSync(path.join(dist, "assets", "index-abc123.js"), "console.log('app')");
  writeFileSync(path.join(dist, "sw.js"), "/* service worker */");
});

afterAll(() => rmSync(dist, { recursive: true, force: true }));

function app() {
  const config = loadConfig({ DATABASE_URL: "unused", NODE_ENV: "test" });
  const db = { $queryRaw: async () => [1] } as unknown as Database;
  const logger = createLogger({ sink: () => {} });
  const instance = createApp({ config, db, logger, imageStorage: createMemoryImageStorage() });
  expect(attachFrontend(instance, dist, logger)).toBe(true);
  return instance;
}

describe("serving the built frontend", () => {
  it("serves index.html at / and for client-side routes (SPA fallback)", async () => {
    const instance = app();
    for (const route of ["/", "/products/123", "/settings/ebay?connected=1"]) {
      const res = await instance.request(route);
      expect(res.status, route).toBe(200);
      expect(await res.text()).toContain("<title>Inventory Admin</title>");
      expect(res.headers.get("cache-control")).toBe("no-cache");
    }
  });

  it("serves hashed assets with long-lived caching and the service worker uncached", async () => {
    const instance = app();
    const asset = await instance.request("/assets/index-abc123.js");
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toContain("immutable");

    const sw = await instance.request("/sw.js");
    expect(sw.headers.get("cache-control")).toBe("no-cache");
  });

  it("never answers API paths with the SPA shell", async () => {
    const instance = app();
    const unknownApi = await instance.request("/api/v1/does-not-exist");
    expect(unknownApi.status).toBe(401); // auth guard, JSON
    expect(unknownApi.headers.get("content-type")).toContain("application/json");

    const health = await instance.request("/api/v1/health");
    expect((await health.json()) as object).toHaveProperty("data");
  });

  it("does not expose files outside the build directory", async () => {
    const res = await app().request("/../../package.json");
    expect(await res.text()).not.toContain('"name"');
  });

  it("reports a missing build instead of failing", () => {
    const config = loadConfig({ DATABASE_URL: "unused", NODE_ENV: "test" });
    const logger = createLogger({ sink: () => {} });
    const instance = createApp({ config, db: {} as Database, logger, imageStorage: createMemoryImageStorage() });
    expect(attachFrontend(instance, path.join(dist, "missing"), logger)).toBe(false);
  });
});

describe("cacheControlFor", () => {
  it("classifies files", () => {
    expect(cacheControlFor("frontend/dist/assets/vendor-x1.js")).toContain("immutable");
    expect(cacheControlFor("frontend/dist/index.html")).toBe("no-cache");
    expect(cacheControlFor("frontend/dist/manifest.webmanifest")).toBe("no-cache");
    expect(cacheControlFor("frontend/dist/workbox-2fbc6a65.js")).toBe("no-cache");
    expect(cacheControlFor("frontend/dist/pwa-192x192.png")).toBe("public, max-age=86400");
  });
});
