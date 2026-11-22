import { createRoute, z } from "@hono/zod-openapi";
import { errorResponseSchema, paginatedEnvelope } from "../../common/http.js";
import { createRouter, type AppDeps } from "../../common/router.js";
import type { ProductStatus } from "../../generated/prisma/enums.js";
import { createProductsService } from "./products.service.js";
import {
  changeStatusSchema,
  createProductSchema,
  listProductsQuerySchema,
  productIdParamSchema,
  productSchema,
  statusChangeSchema,
  updateProductSchema,
} from "./products.schemas.js";

const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });
const errors = {
  400: { description: "Validation error", content: json(errorResponseSchema) },
  401: { description: "Not authenticated", content: json(errorResponseSchema) },
} as const;
const notFoundResponse = { 404: { description: "Product not found", content: json(errorResponseSchema) } } as const;
const security = [{ cookieAuth: [] }];
const tags = ["Products"];

const listRoute = createRoute({
  method: "get",
  path: "/products",
  tags,
  security,
  summary: "List products (paginated, searchable, filterable, sortable)",
  request: { query: listProductsQuerySchema },
  responses: { 200: { description: "Products", content: json(paginatedEnvelope(productSchema)) }, ...errors },
});

const getRoute = createRoute({
  method: "get",
  path: "/products/{id}",
  tags,
  security,
  summary: "Get a product",
  request: { params: productIdParamSchema },
  responses: {
    200: { description: "Product", content: json(z.object({ data: productSchema })) },
    ...errors,
    ...notFoundResponse,
  },
});

const createProductRoute = createRoute({
  method: "post",
  path: "/products",
  tags,
  security,
  summary: "Create a product",
  request: { body: { required: true, content: json(createProductSchema) } },
  responses: {
    201: { description: "Created", content: json(z.object({ data: productSchema })) },
    ...errors,
  },
});

const updateRoute = createRoute({
  method: "patch",
  path: "/products/{id}",
  tags,
  security,
  summary: "Edit product details (not status)",
  request: { params: productIdParamSchema, body: { required: true, content: json(updateProductSchema) } },
  responses: {
    200: { description: "Updated", content: json(z.object({ data: productSchema })) },
    ...errors,
    ...notFoundResponse,
  },
});

const changeStatusRoute = createRoute({
  method: "patch",
  path: "/products/{id}/status",
  tags,
  security,
  summary: "Manually change product status",
  description:
    "Records the change in the status history with source MANUAL. A reason is required when moving a product away from SOLD.",
  request: { params: productIdParamSchema, body: { required: true, content: json(changeStatusSchema) } },
  responses: {
    200: { description: "Status changed", content: json(z.object({ data: productSchema })) },
    ...errors,
    ...notFoundResponse,
    409: { description: "Unchanged or concurrently modified", content: json(errorResponseSchema) },
  },
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/products/{id}",
  tags,
  security,
  summary: "Delete a product that has no eBay history",
  description: "Products with sales or an eBay listing mapping cannot be deleted (409); archive them instead.",
  request: { params: productIdParamSchema },
  responses: {
    204: { description: "Deleted" },
    ...errors,
    ...notFoundResponse,
    409: { description: "Product has history", content: json(errorResponseSchema) },
  },
});

const historyRoute = createRoute({
  method: "get",
  path: "/products/{id}/status-history",
  tags,
  security,
  summary: "Status change history (newest first)",
  request: { params: productIdParamSchema },
  responses: {
    200: { description: "History", content: json(z.object({ data: z.array(statusChangeSchema) })) },
    ...errors,
    ...notFoundResponse,
  },
});

export function createProductRoutes(deps: AppDeps) {
  const service = createProductsService(deps);
  const router = createRouter();

  // The signed-in account's ID goes into every call: an account only sees and changes its own items.
  router.openapi(listRoute, async (c) => c.json(await service.list(c.get("admin").id, c.req.valid("query")), 200));

  router.openapi(getRoute, async (c) =>
    c.json({ data: await service.get(c.get("admin").id, c.req.valid("param").id) }, 200),
  );

  router.openapi(createProductRoute, async (c) =>
    c.json({ data: await service.create(c.get("admin").id, c.req.valid("json")) }, 201),
  );

  router.openapi(updateRoute, async (c) =>
    c.json({ data: await service.update(c.get("admin").id, c.req.valid("param").id, c.req.valid("json")) }, 200),
  );

  router.openapi(changeStatusRoute, async (c) => {
    const { status, reason } = c.req.valid("json");
    const product = await service.changeStatus(c.get("admin").id, c.req.valid("param").id, status as ProductStatus, reason);
    return c.json({ data: product }, 200);
  });

  router.openapi(deleteRoute, async (c) => {
    await service.remove(c.get("admin").id, c.req.valid("param").id);
    return c.body(null, 204);
  });

  router.openapi(historyRoute, async (c) =>
    c.json({ data: await service.statusHistory(c.get("admin").id, c.req.valid("param").id) }, 200),
  );

  return router;
}
