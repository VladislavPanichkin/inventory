import { nowFrom, type AppDeps } from "../../common/router.js";
import { Prisma } from "../../generated/prisma/client.js";
import { ListingStatus, ProductStatus, StatusChangeSource } from "../../generated/prisma/enums.js";
import type { EbayAccountService } from "./ebay-account.service.js";
import { createEbayTradingClient, type EbayActiveListing, type EbayTradingClient } from "./ebay-trading.client.js";

export const PRODUCT_NAME_MAX = 200;

export interface EbayListingDto extends EbayActiveListing {
  /** The inventory product this listing is already linked to, if any. */
  productId: string | null;
}

export type ImportSkipReason =
  /** A product for this eBay item already exists. */
  | "ALREADY_IMPORTED"
  /** eBay sent no usable price, so a product can't be created from it. */
  | "NO_PRICE"
  /** The requested item is not among the seller's active listings (ended, sold, or a wrong ID). */
  | "NOT_ACTIVE";

export interface ImportResult {
  created: { itemId: string; productId: string }[];
  skipped: { itemId: string; reason: ImportSkipReason }[];
}

/**
 * Reads the connected seller's active eBay listings and creates inventory products from them.
 * Read-only toward eBay: nothing here changes a listing.
 */
export function createEbayListingsService(
  deps: AppDeps,
  account: Pick<EbayAccountService, "getAccessToken">,
  overrides: { trading?: EbayTradingClient } = {},
) {
  const { db, config, logger } = deps;
  const log = logger.child({ module: "ebay-listings" });
  const trading =
    overrides.trading ?? createEbayTradingClient({ config, ...(deps.fetch ? { fetch: deps.fetch } : {}) });

  const fetchActive = async () => trading.getActiveListings(await account.getAccessToken());

  async function linkedProductIds(ownerId: string, itemIds: string[]): Promise<Map<string, string>> {
    if (itemIds.length === 0) return new Map();
    const rows = await db.ebayListing.findMany({
      where: { ebayItemId: { in: itemIds }, product: { ownerId } },
      select: { ebayItemId: true, productId: true },
    });
    return new Map(rows.map((row) => [row.ebayItemId, row.productId]));
  }

  return {
    /** The seller's active listings, straight from eBay, marked with the product each one belongs to. */
    async listActive(ownerId: string): Promise<EbayListingDto[]> {
      const listings = await fetchActive();
      const linked = await linkedProductIds(ownerId, listings.map((listing) => listing.itemId));
      return listings.map((listing) => ({ ...listing, productId: linked.get(listing.itemId) ?? null }));
    },

    /**
     * Creates one product per listing that isn't in the inventory yet. `itemIds` limits the
     * import to those items; omitted means all active listings. Title, price and picture are
     * always taken from eBay, never from the caller. The products belong to `ownerId`.
     */
    async importListings(ownerId: string, itemIds?: string[]): Promise<ImportResult> {
      const active = new Map((await fetchActive()).map((listing) => [listing.itemId, listing]));
      const requested = itemIds ? [...new Set(itemIds)] : [...active.keys()];
      const linked = await linkedProductIds(ownerId, requested);
      const now = nowFrom(deps);
      const result: ImportResult = { created: [], skipped: [] };

      for (const itemId of requested) {
        const listing = active.get(itemId);
        if (linked.has(itemId)) {
          result.skipped.push({ itemId, reason: "ALREADY_IMPORTED" });
        } else if (!listing) {
          result.skipped.push({ itemId, reason: "NOT_ACTIVE" });
        } else if (!listing.price) {
          result.skipped.push({ itemId, reason: "NO_PRICE" });
        } else {
          try {
            // One nested write = one transaction: a product never exists without its listing link.
            const product = await db.product.create({
              data: {
                ownerId,
                name: (listing.title ?? `eBay item ${itemId}`).slice(0, PRODUCT_NAME_MAX),
                price: new Prisma.Decimal(listing.price),
                currency: listing.currency ?? config.DEFAULT_CURRENCY,
                status: ProductStatus.AVAILABLE,
                listing: {
                  create: {
                    ebayItemId: itemId,
                    marketplaceId: config.EBAY_MARKETPLACE_ID,
                    title: listing.title,
                    listingStatus: ListingStatus.ACTIVE,
                    listingUrl: listing.listingUrl,
                    imageUrl: listing.imageUrl,
                    lastSyncedAt: now,
                  },
                },
                statusChanges: {
                  create: {
                    fromStatus: null,
                    toStatus: ProductStatus.AVAILABLE,
                    source: StatusChangeSource.IMPORT,
                    reason: `Imported from eBay listing ${itemId}`,
                  },
                },
              },
              select: { id: true },
            });
            result.created.push({ itemId, productId: product.id });
          } catch (error) {
            // Unique eBay item ID: a parallel import got there first.
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
              result.skipped.push({ itemId, reason: "ALREADY_IMPORTED" });
            } else {
              throw error;
            }
          }
        }
      }

      log.info("eBay listings imported", { created: result.created.length, skipped: result.skipped.length });
      return result;
    },
  };
}

export type EbayListingsService = ReturnType<typeof createEbayListingsService>;
