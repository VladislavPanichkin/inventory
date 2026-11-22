import { createRoute, z } from "@hono/zod-openapi";
import { errorBody, errorResponseSchema } from "../../common/http.js";
import { createRouter } from "../../common/router.js";
import { importResultSchema, listingSchema, toEbayApiError } from "../ebay/ebay-listings.routes.js";
import { ebayConnectionSchema } from "../ebay/ebay.routes.js";
import type { DemoEbayService } from "./demo-ebay.service.js";

/** Paths (relative to the API prefix) that change only the simulated connection, not the inventory. */
export const DEMO_EBAY_CONNECT_PATH = "/demo/ebay/connect";
export const DEMO_EBAY_DISCONNECT_PATH = "/demo/ebay/disconnect";

const demoConnectionSchema = ebayConnectionSchema
  .extend({
    photoCredits: z.array(z.string()).openapi({ description: "Credits for the sample listing photos" }),
  })
  .openapi("DemoEbayConnection");

const importBodySchema = z
  .object({
    itemIds: z
      .array(z.string().regex(/^DEMO-\d{4}$/, "must be a sample item ID"))
      .min(1)
      .max(50)
      .optional(),
  })
  .openapi("DemoEbayImportRequest");

const pictureParamsSchema = z.object({
  file: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  size: z.string().regex(/^s-l\d{2,4}\.jpg$/),
});

const tags = ["Demo: simulated eBay"];
const security = [{ cookieAuth: [] }];
const errorContent = { "application/json": { schema: errorResponseSchema } };
const statusResponse = {
  200: { description: "Status", content: { "application/json": { schema: z.object({ data: demoConnectionSchema }) } } },
  404: { description: "Not the demo account", content: errorContent },
};

const statusRoute = createRoute({
  method: "get",
  path: "/demo/ebay",
  tags,
  security,
  summary: "Status of the simulated eBay connection (demo account only)",
  responses: statusResponse,
});

const connectRoute = createRoute({
  method: "post",
  path: DEMO_EBAY_CONNECT_PATH,
  tags,
  security,
  summary: "Connect the sample seller account (stands in for eBay's sign-in and consent)",
  responses: statusResponse,
});

const disconnectRoute = createRoute({
  method: "post",
  path: DEMO_EBAY_DISCONNECT_PATH,
  tags,
  security,
  summary: "Disconnect the sample seller account",
  responses: statusResponse,
});

const listRoute = createRoute({
  method: "get",
  path: "/demo/ebay/listings",
  tags,
  security,
  summary: "The sample seller's active listings",
  responses: {
    200: { description: "Listings", content: { "application/json": { schema: z.object({ data: z.array(listingSchema) }) } } },
    404: { description: "Not the demo account", content: errorContent },
    409: { description: "The sample account is not connected", content: errorContent },
  },
});

const importRoute = createRoute({
  method: "post",
  path: "/demo/ebay/listings/import",
  tags,
  security,
  summary: "Create demo products from sample listings (uses the real import code)",
  request: { body: { required: false, content: { "application/json": { schema: importBodySchema } } } },
  responses: {
    200: { description: "Import result", content: { "application/json": { schema: z.object({ data: importResultSchema }) } } },
    400: { description: "Invalid request", content: errorContent },
    404: { description: "Not the demo account", content: errorContent },
    409: { description: "The sample account is not connected", content: errorContent },
  },
});

const pictureRoute = createRoute({
  method: "get",
  path: "/demo/ebay/pictures/{file}/{size}",
  tags,
  security,
  summary: "Picture of a sample listing (shaped like an eBay picture address)",
  request: { params: pictureParamsSchema },
  responses: {
    200: { description: "JPEG bytes", content: { "image/jpeg": { schema: z.any().openapi({ type: "string", format: "binary" }) } } },
    404: { description: "Not found", content: errorContent },
  },
});

/**
 * The simulated eBay, for the demo account only. The administrator gets 404 here: the
 * administrator uses the real eBay routes, and the two never mix.
 */
export function createDemoEbayRoutes(demoEbay: DemoEbayService) {
  const router = createRouter();

  router.use("/demo/*", async (c, next) => {
    if (c.get("admin")?.role !== "DEMO") {
      return c.json(errorBody("NOT_FOUND", `Route ${c.req.method} ${c.req.path} not found`, undefined, c.get("requestId")), 404);
    }
    return next();
  });

  const withCredits = async (status: Awaited<ReturnType<DemoEbayService["status"]>>) => ({
    ...status,
    photoCredits: demoEbay.photoCredits(),
  });

  router.openapi(statusRoute, async (c) => c.json({ data: await withCredits(await demoEbay.status(c.get("admin").id)) }, 200));

  router.openapi(connectRoute, async (c) => c.json({ data: await withCredits(await demoEbay.connect(c.get("admin").id)) }, 200));

  router.openapi(disconnectRoute, async (c) =>
    c.json({ data: await withCredits(await demoEbay.disconnect(c.get("admin").id)) }, 200),
  );

  router.openapi(listRoute, async (c) => {
    try {
      return c.json({ data: await demoEbay.listActive(c.get("admin").id) }, 200);
    } catch (error) {
      throw toEbayApiError(error);
    }
  });

  router.openapi(importRoute, async (c) => {
    // The body is optional: no body means "add everything".
    const hasBody = (c.req.header("Content-Type") ?? "").includes("application/json");
    const itemIds = hasBody ? c.req.valid("json").itemIds : undefined;
    try {
      return c.json({ data: await demoEbay.importListings(c.get("admin").id, itemIds) }, 200);
    } catch (error) {
      throw toEbayApiError(error);
    }
  });

  // The typed route helper expects JSON responses; this one returns raw image bytes.
  router.openapi(pictureRoute, async (c) => {
    const { file, size } = c.req.valid("param");
    const sizePx = Number(/\d+/.exec(size)![0]);
    const bytes = await demoEbay.openPicture(file, sizePx);
    return c.newResponse(bytes as Uint8Array<ArrayBuffer>, 200, {
      "Content-Type": "image/jpeg",
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, max-age=86400",
      "Content-Disposition": "inline",
    }) as never;
  });

  return router;
}
