import { createRoute, z } from "@hono/zod-openapi";
import { AppError } from "../../common/errors.js";
import { errorResponseSchema } from "../../common/http.js";
import { createRouter } from "../../common/router.js";
import {
  EbayAuthorizationError,
  EbayNotConfiguredError,
  EbayNotConnectedError,
  EbayRequestError,
  EbayUnavailableError,
} from "./ebay-errors.js";
import type { EbayListingsService } from "./ebay-listings.service.js";

export const MAX_IMPORT_ITEMS = 500;

export const listingSchema = z
  .object({
    itemId: z.string(),
    title: z.string().nullable(),
    price: z.string().nullable().openapi({ example: "149.90" }),
    currency: z.string().nullable(),
    listingUrl: z.string().nullable(),
    imageUrl: z.string().nullable(),
    quantityAvailable: z.number().int().nullable(),
    listingType: z.string().nullable(),
    productId: z.string().nullable().openapi({ description: "Inventory product already linked to this listing" }),
  })
  .openapi("EbayActiveListing");

const importBodySchema = z
  .object({
    itemIds: z
      .array(z.string().regex(/^\d{6,20}$/, "must be an eBay item ID"))
      .min(1)
      .max(MAX_IMPORT_ITEMS)
      .optional()
      .openapi({ description: "Limit the import to these eBay item IDs. Omit to import every active listing." }),
  })
  .openapi("EbayImportRequest");

export const importResultSchema = z
  .object({
    created: z.array(z.object({ itemId: z.string(), productId: z.string() })),
    skipped: z.array(
      z.object({ itemId: z.string(), reason: z.enum(["ALREADY_IMPORTED", "NO_PRICE", "NOT_ACTIVE"]) }),
    ),
  })
  .openapi("EbayImportResult");

const tags = ["eBay integration"];
const security = [{ cookieAuth: [] }];
const errorContent = { "application/json": { schema: errorResponseSchema } };
const ebayErrors = {
  401: { description: "Not authenticated", content: errorContent },
  409: { description: "eBay is not configured, not connected, or must be reconnected", content: errorContent },
  502: { description: "eBay rejected the request", content: errorContent },
  503: { description: "eBay is temporarily unavailable", content: errorContent },
};

const listRoute = createRoute({
  method: "get",
  path: "/integrations/ebay/listings",
  tags,
  security,
  summary: "The connected seller's active eBay listings (read live from eBay)",
  responses: {
    200: { description: "Listings", content: { "application/json": { schema: z.object({ data: z.array(listingSchema) }) } } },
    ...ebayErrors,
  },
});

const importRoute = createRoute({
  method: "post",
  path: "/integrations/ebay/listings/import",
  tags,
  security,
  summary: "Create inventory products from active eBay listings",
  description: "Skips listings that already have a product. Reads from eBay only; no listing is changed.",
  request: { body: { required: false, content: { "application/json": { schema: importBodySchema } } } },
  responses: {
    200: { description: "Import result", content: { "application/json": { schema: z.object({ data: importResultSchema }) } } },
    400: { description: "Invalid request", content: errorContent },
    ...ebayErrors,
  },
});

/** Translates eBay failures into API errors the frontend can explain. Unknown errors pass through. */
export function toEbayApiError(error: unknown): unknown {
  if (error instanceof EbayNotConfiguredError) {
    return new AppError(409, "EBAY_NOT_CONFIGURED", "eBay API credentials are not configured on the server");
  }
  if (error instanceof EbayNotConnectedError) {
    return new AppError(409, "EBAY_NOT_CONNECTED", "No eBay account is connected. Connect eBay first.");
  }
  if (error instanceof EbayAuthorizationError) {
    return new AppError(409, "EBAY_REAUTH_REQUIRED", `${error.message}. Reconnect eBay.`);
  }
  if (error instanceof EbayUnavailableError) {
    return new AppError(503, "EBAY_UNAVAILABLE", "eBay is not reachable right now. Try again in a moment.");
  }
  if (error instanceof EbayRequestError) {
    return new AppError(502, "EBAY_REJECTED", error.message);
  }
  return error;
}

export function createEbayListingsRoutes(listings: EbayListingsService) {
  const router = createRouter();

  router.openapi(listRoute, async (c) => {
    try {
      return c.json({ data: await listings.listActive(c.get("admin").id) }, 200);
    } catch (error) {
      throw toEbayApiError(error);
    }
  });

  router.openapi(importRoute, async (c) => {
    // The body is optional: no body means "import everything".
    const hasBody = (c.req.header("Content-Type") ?? "").includes("application/json");
    const itemIds = hasBody ? c.req.valid("json").itemIds : undefined;
    try {
      return c.json({ data: await listings.importListings(c.get("admin").id, itemIds) }, 200);
    } catch (error) {
      throw toEbayApiError(error);
    }
  });

  return router;
}
