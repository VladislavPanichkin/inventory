import { z } from "@hono/zod-openapi";
import { paginationQuerySchema } from "../../common/pagination.js";

export const saleStatusSchema = z.enum(["CONFIRMED", "CANCELLED"]).openapi("SaleStatus");

export const saleSchema = z
  .object({
    id: z.string().uuid(),
    product: z.object({ id: z.string().uuid(), name: z.string() }),
    ebayOrderId: z.string(),
    ebayLineItemId: z.string(),
    ebayItemId: z.string().nullable(),
    quantity: z.number().int(),
    soldPrice: z.string().openapi({ example: "149.90" }),
    currency: z.string(),
    soldAt: z.string(),
    saleStatus: saleStatusSchema,
    cancelledAt: z.string().nullable(),
    cancellationReason: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("Sale");

export const listSalesQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional().openapi({ description: "Matches eBay order ID or product name" }),
  status: saleStatusSchema.optional(),
});

export const saleIdParamSchema = z.object({
  id: z.string().uuid().openapi({ param: { name: "id", in: "path" } }),
});

export type SaleDto = z.infer<typeof saleSchema>;
export type ListSalesQuery = z.infer<typeof listSalesQuerySchema>;
