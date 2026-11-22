import { AppError, conflict, notFound } from "../../common/errors.js";
import { paginationArgs, paginationMeta } from "../../common/pagination.js";
import type { AppDeps } from "../../common/router.js";
import { Prisma } from "../../generated/prisma/client.js";
import { ProductStatus, StatusChangeSource } from "../../generated/prisma/enums.js";
import { createImagesService } from "../images/images.service.js";
import { checkManualTransition } from "./product-status.js";
import { productInclude, toProductDto, toStatusChangeDto } from "./products.mapper.js";
import type { CreateProductInput, ListProductsQuery, UpdateProductInput } from "./products.schemas.js";


/** Filter for the product list. Always limited to the items of `ownerId`. */
export function buildProductWhere(
  ownerId: string,
  query: Pick<ListProductsQuery, "search" | "status">,
): Prisma.ProductWhereInput {
  const where: Prisma.ProductWhereInput = { ownerId };

  if (query.status === undefined) {
    where.status = { not: ProductStatus.ARCHIVED };
  } else if (query.status !== "ALL") {
    where.status = { in: query.status.split(",").map((s) => s.trim() as ProductStatus) };
  }

  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: "insensitive" } },
      { listing: { ebayItemId: query.search } },
    ];
  }
  return where;
}

/**
 * Every method takes the signed-in account's ID first and only ever touches that account's
 * items. Someone else's product is reported as "not found", never as "forbidden", so IDs
 * can't be probed.
 */
export function createProductsService(deps: AppDeps) {
  const { db } = deps;
  const images = createImagesService(deps);

  async function getOrThrow(ownerId: string, id: string) {
    const product = await db.product.findFirst({ where: { id, ownerId }, include: productInclude });
    if (!product) throw notFound("Product", id);
    return product;
  }

  return {
    async list(ownerId: string, query: ListProductsQuery) {
      const where = buildProductWhere(ownerId, query);
      const [total, rows] = await db.$transaction([
        db.product.count({ where }),
        db.product.findMany({
          where,
          include: productInclude,
          // Secondary sort on id keeps pagination stable when values tie.
          orderBy: [{ [query.sort]: query.order }, { id: "asc" }],
          ...paginationArgs(query),
        }),
      ]);
      return { data: rows.map(toProductDto), meta: paginationMeta(query, total) };
    },

    async get(ownerId: string, id: string) {
      return toProductDto(await getOrThrow(ownerId, id));
    },

    async create(ownerId: string, input: CreateProductInput) {
      const status = input.status ?? ProductStatus.AVAILABLE;
      const product = await db.product.create({
        data: {
          ownerId,
          name: input.name,
          description: input.description ?? null,
          price: new Prisma.Decimal(input.price),
          currency: input.currency ?? deps.config.DEFAULT_CURRENCY,
          condition: input.condition ?? null,
          status,
          statusChanges: {
            create: { fromStatus: null, toStatus: status, source: StatusChangeSource.MANUAL, reason: "Product created" },
          },
        },
        include: productInclude,
      });
      deps.logger.info("Product created", { productId: product.id });
      return toProductDto(product);
    },

    async update(ownerId: string, id: string, input: UpdateProductInput) {
      await getOrThrow(ownerId, id);
      const product = await db.product.update({
        where: { id, ownerId },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.price !== undefined && { price: new Prisma.Decimal(input.price) }),
          ...(input.currency !== undefined && { currency: input.currency }),
          ...(input.condition !== undefined && { condition: input.condition }),
        },
        include: productInclude,
      });
      return toProductDto(product);
    },

    /**
     * Manual status correction by the admin. Records history in the same transaction.
     * Uses a compare-and-set update so a concurrent change (e.g. a sale being
     * processed) is never silently overwritten.
     */
    async changeStatus(ownerId: string, id: string, to: ProductStatus, reason: string | undefined) {
      return db.$transaction(async (tx) => {
        const current = await tx.product.findFirst({ where: { id, ownerId } });
        if (!current) throw notFound("Product", id);

        const check = checkManualTransition(current.status, to, reason);
        if (!check.ok) {
          throw new AppError(check.code === "STATUS_UNCHANGED" ? 409 : 400, check.code, check.message);
        }

        const updated = await tx.product.updateMany({
          where: { id, ownerId, status: current.status },
          data: { status: to },
        });
        if (updated.count === 0) {
          throw conflict("The product status was changed by another process. Reload and try again.");
        }
        await tx.productStatusChange.create({
          data: {
            productId: id,
            fromStatus: current.status,
            toStatus: to,
            source: StatusChangeSource.MANUAL,
            reason: reason?.trim() || null,
          },
        });
        deps.logger.info("Product status changed manually", { productId: id, from: current.status, to });
        const product = await tx.product.findUniqueOrThrow({ where: { id }, include: productInclude });
        return toProductDto(product);
      });
    },

    /**
     * Hard delete, allowed only for products that never touched eBay.
     * Products with sales or a listing mapping must be archived instead, to keep history.
     * The product's photo files are removed from storage as well.
     */
    async remove(ownerId: string, id: string) {
      const product = await db.product.findFirst({
        where: { id, ownerId },
        include: {
          listing: { select: { id: true } },
          images: { select: { storageKey: true, thumbKey: true } },
          _count: { select: { sales: true } },
        },
      });
      if (!product) throw notFound("Product", id);
      if (product._count.sales > 0 || product.listing) {
        throw new AppError(
          409,
          "PRODUCT_HAS_HISTORY",
          "This product has eBay sales or a listing mapping and cannot be deleted. Archive it instead.",
        );
      }
      // Rows first (photo rows cascade), then the files they pointed at.
      await db.product.delete({ where: { id, ownerId } });
      await images.deleteObjects(product.images.flatMap((image) => [image.storageKey, image.thumbKey]));
      deps.logger.info("Product deleted", { productId: id, photosRemoved: product.images.length });
    },

    async statusHistory(ownerId: string, id: string) {
      await getOrThrow(ownerId, id);
      const changes = await db.productStatusChange.findMany({
        where: { productId: id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 200,
      });
      return changes.map(toStatusChangeDto);
    },
  };
}

export type ProductsService = ReturnType<typeof createProductsService>;
