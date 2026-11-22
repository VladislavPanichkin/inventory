/**
 * Node-only: serves the built admin web app (frontend/dist) from the same origin as the API,
 * so a single deployment has one address (first-party session cookies, no CORS).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";
import type { Logger } from "../common/logger.js";

const isApiPath = (requestPath: string) => requestPath === "/api" || requestPath.startsWith("/api/");

/** Long-lived caching only for content-hashed build files; everything else revalidates. */
export function cacheControlFor(filePath: string): string {
  const normalized = filePath.replaceAll("\\", "/");
  if (normalized.includes("/assets/")) return "public, max-age=31536000, immutable";
  if (/\/(sw\.js|workbox-[^/]+\.js|index\.html|manifest\.webmanifest)$/.test(normalized)) return "no-cache";
  return "public, max-age=86400";
}

/** Hono's generic parameters vary per app; this helper only adds GET middleware/routes. */
export function attachFrontend(app: Hono<any>, distDir: string, logger: Logger): boolean {
  const indexFile = path.join(distDir, "index.html");
  if (!existsSync(indexFile)) {
    logger.warn("Frontend build not found; serving the API only", { distDir });
    return false;
  }
  const indexHtml = readFileSync(indexFile, "utf8");
  // serveStatic resolves `root` relative to the working directory.
  const root = path.relative(process.cwd(), distDir) || ".";

  const assets = serveStatic({ root });

  app.use("*", async (c, next) => {
    if (isApiPath(c.req.path) || (c.req.method !== "GET" && c.req.method !== "HEAD")) return next();
    const response = await assets(c, next);
    // serveStatic builds its own Response (headers set on the context are not applied),
    // so caching headers are added to the returned response.
    if (response instanceof Response) {
      const servedPath = c.req.path.endsWith("/") ? `${c.req.path}index.html` : c.req.path;
      response.headers.set("Cache-Control", cacheControlFor(servedPath));
      return response;
    }
    return response;
  });

  // Client-side routes (/products/123, /settings/ebay…) all load the SPA shell.
  app.get("*", async (c, next) => {
    if (isApiPath(c.req.path)) return next();
    c.header("Cache-Control", "no-cache");
    return c.html(indexHtml);
  });

  logger.info("Serving frontend", { distDir });
  return true;
}
