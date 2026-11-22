import type { EbayListing, Product, ProductImage, ProductStatusChange } from "../../generated/prisma/client.js";
import { moneyToString } from "../../common/money.js";
import { imageOrder, toProductImageDto } from "../images/images.schemas.js";
import type { ProductDto } from "./products.schemas.js";

/** Relations loaded with every product: its eBay listing and its photos (main photo first). */
export const productInclude = { listing: true, images: { orderBy: imageOrder } } as const;

export type ProductWithRelations = Product & { listing: EbayListing | null; images: ProductImage[] };

export function toProductDto(product: ProductWithRelations): ProductDto {
  const { listing } = product;
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    price: moneyToString(product.price),
    currency: product.currency,
    condition: product.condition,
    status: product.status,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
    listing: listing
      ? {
          id: listing.id,
          ebayItemId: listing.ebayItemId,
          marketplaceId: listing.marketplaceId,
          title: listing.title,
          listingStatus: listing.listingStatus,
          listingUrl: listing.listingUrl,
          imageUrl: listing.imageUrl,
          lastSyncedAt: listing.lastSyncedAt?.toISOString() ?? null,
        }
      : null,
    images: product.images.map(toProductImageDto),
  };
}

export function toStatusChangeDto(change: ProductStatusChange) {
  return {
    id: change.id,
    fromStatus: change.fromStatus,
    toStatus: change.toStatus,
    source: change.source,
    reason: change.reason,
    saleId: change.saleId,
    createdAt: change.createdAt.toISOString(),
  };
}
