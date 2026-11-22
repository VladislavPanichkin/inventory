import { z } from "@hono/zod-openapi";
import { currencySchema, moneyInputSchema } from "../../common/money.js";
import { paginationQuerySchema } from "../../common/pagination.js";
import { productImageSchema } from "../images/images.schemas.js";
import { INITIAL_STATUSES, PRODUCT_STATUSES } from "./product-status.js";

// ---------- Output DTOs ----------

export const productStatusSchema = z.enum(PRODUCT_STATUSES as [string, ...string[]]).openapi("ProductStatus");
export const listingStatusSchema = z.enum(["ACTIVE", "ENDED", "UNKNOWN"]).openapi("ListingStatus");

export const listingSummarySchema = z
  .object({
    id: z.string().uuid(),
    ebayItemId: z.string(),
    marketplaceId: z.string(),
    title: z.string().nullable(),
    listingStatus: listingStatusSchema,
    listingUrl: z.string().nullable(),
    imageUrl: z.string().nullable().openapi({ description: "eBay's picture of the listing (hosted by eBay)" }),
    lastSyncedAt: z.string().nullable(),
  })
  .openapi("EbayListingSummary");

export const productSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    description: z.string().nullable(),
    price: z.string().openapi({ example: "149.90" }),
    currency: z.string(),
    condition: z.string().nullable(),
    status: productStatusSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
    listing: listingSummarySchema.nullable(),
    /** Uploaded photos, main photo first. */
    images: z.array(productImageSchema),
  })
  .openapi("Product");

export const statusChangeSchema = z
  .object({
    id: z.string().uuid(),
    fromStatus: productStatusSchema.nullable(),
    toStatus: productStatusSchema,
    source: z.enum(["MANUAL", "EBAY_ORDER", "EBAY_CANCELLATION", "IMPORT", "SYSTEM"]),
    reason: z.string().nullable(),
    saleId: z.string().uuid().nullable(),
    createdAt: z.string(),
  })
  .openapi("ProductStatusChange");

// ---------- Inputs ----------

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional();

export const createProductSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: optionalText(5000),
    price: moneyInputSchema,
    currency: currencySchema.optional(),
    condition: optionalText(100),
    status: z.enum(INITIAL_STATUSES).optional(),
  })
  .openapi("CreateProductRequest");

export const updateProductSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: optionalText(5000),
    price: moneyInputSchema.optional(),
    currency: currencySchema.optional(),
    condition: optionalText(100),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "at least one field must be provided")
  .openapi("UpdateProductRequest");

export const changeStatusSchema = z
  .object({
    status: productStatusSchema,
    reason: z.string().trim().max(500).optional(),
  })
  .openapi("ChangeProductStatusRequest");

export const PRODUCT_SORT_FIELDS = ["name", "price", "createdAt", "updatedAt"] as const;

/**
 * `status` accepts a comma-separated list (e.g. `AVAILABLE,RESERVED`) or `ALL`.
 * When omitted, ARCHIVED products are excluded.
 */
export const listProductsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional().openapi({ description: "Matches name (case-insensitive) or exact eBay item ID" }),
  status: z
    .string()
    .optional()
    .refine(
      (value) =>
        value === undefined ||
        value === "ALL" ||
        value.split(",").every((part) => (PRODUCT_STATUSES as string[]).includes(part.trim())),
      "must be ALL or a comma-separated list of product statuses",
    )
    .openapi({ example: "AVAILABLE,RESERVED" }),
  sort: z.enum(PRODUCT_SORT_FIELDS).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export const productIdParamSchema = z.object({
  id: z.string().uuid().openapi({ param: { name: "id", in: "path" } }),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
export type ProductDto = z.infer<typeof productSchema>;
