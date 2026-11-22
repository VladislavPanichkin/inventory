import { createRoute, z } from "@hono/zod-openapi";
import { isEbayConfigured } from "../../config/env.js";
import { dataEnvelope } from "../../common/http.js";
import { createRouter, type AppDeps } from "../../common/router.js";
import { APP_VERSION } from "../../common/version.js";
import { checkDatabase } from "../../infrastructure/database.js";

const healthSchema = z
  .object({
    status: z.enum(["ok", "degraded"]),
    version: z.string(),
    environment: z.string(),
    timestamp: z.string().openapi({ format: "date-time" }),
    checks: z.object({
      database: z.object({
        status: z.enum(["up", "down"]),
        latencyMs: z.number(),
      }),
      ebayCredentials: z.object({
        status: z.enum(["configured", "missing"]),
      }),
    }),
  })
  .openapi("Health");

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  tags: ["System"],
  summary: "Liveness and dependency status",
  description:
    "Public endpoint (no session needed). Reports whether the database is reachable and whether eBay credentials are configured. Never returns error details or secrets.",
  responses: {
    200: { description: "All dependencies healthy", content: { "application/json": { schema: dataEnvelope(healthSchema) } } },
    503: { description: "A dependency is unavailable", content: { "application/json": { schema: dataEnvelope(healthSchema) } } },
  },
});

export function createHealthRoutes(deps: AppDeps) {
  const router = createRouter();

  router.openapi(healthRoute, async (c) => {
    const db = await checkDatabase(deps.db);
    if (!db.ok) {
      deps.logger.error("Health check: database unreachable", { error: db.error, requestId: c.get("requestId") });
    }

    const body = {
      data: {
        status: db.ok ? ("ok" as const) : ("degraded" as const),
        version: APP_VERSION,
        environment: deps.config.NODE_ENV,
        timestamp: (deps.now?.() ?? new Date()).toISOString(),
        checks: {
          database: { status: db.ok ? ("up" as const) : ("down" as const), latencyMs: db.latencyMs },
          ebayCredentials: { status: isEbayConfigured(deps.config) ? ("configured" as const) : ("missing" as const) },
        },
      },
    };
    return db.ok ? c.json(body, 200) : c.json(body, 503);
  });

  return router;
}
