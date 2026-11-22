import { createRoute, z } from "@hono/zod-openapi";
import { errorResponseSchema } from "../../common/http.js";
import { createRouter, type AppDeps } from "../../common/router.js";
import { saleSchema } from "../sales/sales.schemas.js";
import { createDashboardService } from "./dashboard.service.js";

const summarySchema = z
  .object({
    products: z.object({
      total: z.number().int(),
      available: z.number().int(),
      reserved: z.number().int(),
      sold: z.number().int(),
      archived: z.number().int(),
    }),
    recentSales: z.array(saleSchema),
    ebay: z.object({
      connectionStatus: z.enum(["NOT_CONNECTED", "CONNECTED", "DISCONNECTED", "REAUTH_REQUIRED"]),
      sellerUsername: z.string().nullable(),
      marketplaceId: z.string().nullable(),
    }),
    sync: z.object({
      lastSuccessfulSyncAt: z.string().nullable(),
      lastSyncStatus: z.enum(["RUNNING", "SUCCESS", "FAILED", "PARTIAL"]).nullable(),
      lastSyncStartedAt: z.string().nullable(),
      failedNotifications: z.number().int(),
      openIssues: z.number().int(),
    }),
    warnings: z.array(
      z.object({ code: z.string(), severity: z.enum(["info", "warning", "error"]), message: z.string() }),
    ),
  })
  .openapi("DashboardSummary");

const summaryRoute = createRoute({
  method: "get",
  path: "/dashboard/summary",
  tags: ["Dashboard"],
  security: [{ cookieAuth: [] }],
  summary: "Inventory statistics, recent sales and synchronization health",
  responses: {
    200: { description: "Summary", content: { "application/json": { schema: z.object({ data: summarySchema }) } } },
    401: { description: "Not authenticated", content: { "application/json": { schema: errorResponseSchema } } },
  },
});

export function createDashboardRoutes(deps: AppDeps) {
  const service = createDashboardService(deps);
  const router = createRouter();
  router.openapi(summaryRoute, async (c) => c.json({ data: await service.summary(c.get("admin")) }, 200));
  return router;
}
