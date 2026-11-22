import { notFound } from "../../common/errors.js";
import { moneyToString } from "../../common/money.js";
import { paginationArgs, paginationMeta } from "../../common/pagination.js";
import type { AppDeps } from "../../common/router.js";
import type { Prisma, Sale } from "../../generated/prisma/client.js";
import type { ListSalesQuery, SaleDto } from "./sales.schemas.js";

const withProduct = { product: { select: { id: true, name: true } } } as const;

type SaleWithProduct = Sale & { product: { id: string; name: string } };

export function toSaleDto(sale: SaleWithProduct): SaleDto {
  return {
    id: sale.id,
    product: sale.product,
    ebayOrderId: sale.ebayOrderId,
    ebayLineItemId: sale.ebayLineItemId,
    ebayItemId: sale.ebayItemId,
    quantity: sale.quantity,
    soldPrice: moneyToString(sale.soldPrice),
    currency: sale.currency,
    soldAt: sale.soldAt.toISOString(),
    saleStatus: sale.saleStatus,
    cancelledAt: sale.cancelledAt?.toISOString() ?? null,
    cancellationReason: sale.cancellationReason,
    createdAt: sale.createdAt.toISOString(),
  };
}

/**
 * Read side of the Sales module. Sales are created by order processing (Phase 5), never via the API.
 * A sale belongs to the account that owns its product; every method is limited to `ownerId`.
 */
export function createSalesService(deps: AppDeps) {
  const { db } = deps;

  return {
    async list(ownerId: string, query: ListSalesQuery) {
      const where: Prisma.SaleWhereInput = {
        product: { ownerId },
        ...(query.status && { saleStatus: query.status }),
        ...(query.search && {
          OR: [
            { ebayOrderId: { contains: query.search, mode: "insensitive" } },
            { product: { name: { contains: query.search, mode: "insensitive" } } },
          ],
        }),
      };
      const [total, rows] = await db.$transaction([
        db.sale.count({ where }),
        db.sale.findMany({
          where,
          include: withProduct,
          orderBy: [{ soldAt: "desc" }, { id: "asc" }],
          ...paginationArgs(query),
        }),
      ]);
      return { data: rows.map(toSaleDto), meta: paginationMeta(query, total) };
    },

    async get(ownerId: string, id: string) {
      const sale = await db.sale.findFirst({ where: { id, product: { ownerId } }, include: withProduct });
      if (!sale) throw notFound("Sale", id);
      return toSaleDto(sale);
    },

    async listForProduct(ownerId: string, productId: string) {
      const exists = await db.product.count({ where: { id: productId, ownerId } });
      if (!exists) throw notFound("Product", productId);
      const sales = await db.sale.findMany({
        where: { productId, product: { ownerId } },
        include: withProduct,
        orderBy: [{ soldAt: "desc" }, { id: "asc" }],
      });
      return sales.map(toSaleDto);
    },

    async recent(ownerId: string, limit: number) {
      const sales = await db.sale.findMany({
        where: { product: { ownerId } },
        include: withProduct,
        orderBy: [{ soldAt: "desc" }, { id: "asc" }],
        take: limit,
      });
      return sales.map(toSaleDto);
    },
  };
}
