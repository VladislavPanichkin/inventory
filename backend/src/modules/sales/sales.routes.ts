import { createRoute, z } from "@hono/zod-openapi";
import { errorResponseSchema, paginatedEnvelope } from "../../common/http.js";
import { createRouter, type AppDeps } from "../../common/router.js";
import { productIdParamSchema } from "../products/products.schemas.js";
import { createSalesService } from "./sales.service.js";
import { listSalesQuerySchema, saleIdParamSchema, saleSchema } from "./sales.schemas.js";

const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });
const errors = {
  400: { description: "Validation error", content: json(errorResponseSchema) },
  401: { description: "Not authenticated", content: json(errorResponseSchema) },
} as const;
const security = [{ cookieAuth: [] }];
const tags = ["Sales"];

const listRoute = createRoute({
  method: "get",
  path: "/sales",
  tags,
  security,
  summary: "List sales (newest first)",
  request: { query: listSalesQuerySchema },
  responses: { 200: { description: "Sales", content: json(paginatedEnvelope(saleSchema)) }, ...errors },
});

const getRoute = createRoute({
  method: "get",
  path: "/sales/{id}",
  tags,
  security,
  summary: "Get a sale",
  request: { params: saleIdParamSchema },
  responses: {
    200: { description: "Sale", content: json(z.object({ data: saleSchema })) },
    ...errors,
    404: { description: "Not found", content: json(errorResponseSchema) },
  },
});

const productSalesRoute = createRoute({
  method: "get",
  path: "/products/{id}/sales",
  tags,
  security,
  summary: "Sales history of a product",
  request: { params: productIdParamSchema },
  responses: {
    200: { description: "Sales", content: json(z.object({ data: z.array(saleSchema) })) },
    ...errors,
    404: { description: "Product not found", content: json(errorResponseSchema) },
  },
});

export function createSalesRoutes(deps: AppDeps) {
  const service = createSalesService(deps);
  const router = createRouter();

  router.openapi(listRoute, async (c) => c.json(await service.list(c.get("admin").id, c.req.valid("query")), 200));
  router.openapi(getRoute, async (c) =>
    c.json({ data: await service.get(c.get("admin").id, c.req.valid("param").id) }, 200),
  );
  router.openapi(productSalesRoute, async (c) =>
    c.json({ data: await service.listForProduct(c.get("admin").id, c.req.valid("param").id) }, 200),
  );

  return router;
}
