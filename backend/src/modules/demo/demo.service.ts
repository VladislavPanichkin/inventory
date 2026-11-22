import { nowFrom, type AppDeps } from "../../common/router.js";
import { Prisma } from "../../generated/prisma/client.js";
import { ListingStatus, StatusChangeSource, UserRole } from "../../generated/prisma/enums.js";
import { MAX_FULL_BYTES, MAX_THUMB_BYTES } from "../images/images.schemas.js";
import { readJpegInfo } from "../images/jpeg.js";
import { DEMO_PRODUCTS, type DemoProduct } from "./demo-data.js";
import { demoPictureUrl } from "./demo-ebay.service.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const JPEG = "image/jpeg";

/** A sample photo already uploaded to storage, waiting for its database row. */
interface StoredSamplePhoto {
  id: string;
  storageKey: string;
  thumbKey: string;
  width: number;
  height: number;
  sizeBytes: number;
}

/** Thrown when a demo-only operation is attempted on an account that is not the demo account. */
export class NotDemoAccountError extends Error {
  constructor() {
    super("This operation is only allowed on the demo account");
    this.name = "NotDemoAccountError";
  }
}

/**
 * The demo account's data and change allowance.
 *
 * Every write here filters on `role = DEMO` in the database query itself, so even a wrong
 * user ID passed in by mistake can never delete or reset the administrator's inventory.
 */
export function createDemoService(deps: AppDeps) {
  const { db, config } = deps;
  const log = deps.logger.child({ module: "demo" });

  /** Products owned by this user, and only if that user is the demo account. */
  const demoProducts = (userId: string) =>
    ({ owner: { id: userId, role: UserRole.DEMO } }) satisfies Prisma.ProductWhereInput;

  /** Removes all of the demo account's items inside `tx`, returning the storage keys of their photos. */
  async function wipe(tx: Prisma.TransactionClient, userId: string): Promise<string[]> {
    const where = demoProducts(userId);
    const photos = await tx.productImage.findMany({
      where: { product: where },
      select: { storageKey: true, thumbKey: true },
    });
    // Sales block product deletion, so they go first. Listings, photos and history cascade.
    await tx.sale.deleteMany({ where: { product: where } });
    await tx.product.deleteMany({ where });
    return photos.flatMap((photo) => [photo.storageKey, photo.thumbKey]);
  }

  /** Photo files are removed after their rows are gone; a failure only leaves unused files behind. */
  async function deletePhotoFiles(keys: string[]) {
    if (keys.length === 0) return;
    try {
      await deps.imageStorage.delete(keys);
    } catch (error) {
      log.error("Could not delete demo photo objects (orphaned in storage)", { keys, error });
    }
  }

  /**
   * Uploads an item's bundled sample photo for the product about to be created.
   * Returns null (the item simply has no photo) when there is no photo source, the file is
   * missing, or it isn't a JPEG within the normal upload limits.
   */
  async function storeSamplePhoto(item: DemoProduct, productId: string): Promise<StoredSamplePhoto | null> {
    if (!item.photo || !deps.demoPhotos) return null;
    const [full, thumb] = await Promise.all([
      deps.demoPhotos(`${item.photo.file}.jpg`),
      deps.demoPhotos(`${item.photo.file}_thumb.jpg`),
    ]);
    const info = full && readJpegInfo(full);
    const usable =
      full && thumb && info && readJpegInfo(thumb) && full.byteLength <= MAX_FULL_BYTES && thumb.byteLength <= MAX_THUMB_BYTES;
    if (!full || !thumb || !info || !usable) {
      log.warn("Sample photo missing or unusable; the item is shown without it", { file: item.photo.file });
      return null;
    }
    const id = crypto.randomUUID();
    const storageKey = `products/${productId}/${id}.jpg`;
    const thumbKey = `products/${productId}/${id}_thumb.jpg`;
    const puts = await Promise.allSettled([
      deps.imageStorage.put(storageKey, full, JPEG),
      deps.imageStorage.put(thumbKey, thumb, JPEG),
    ]);
    const failed = puts.find((put) => put.status === "rejected");
    if (failed) {
      // One of the two files may have been stored: never leave half a photo behind.
      await deletePhotoFiles([storageKey, thumbKey]);
      throw failed.reason;
    }
    return { id, storageKey, thumbKey, width: info.width, height: info.height, sizeBytes: full.byteLength };
  }

  return {
    /** Replaces the demo account's items with the sample inventory and gives back its full change allowance. */
    async reset(userId: string): Promise<void> {
      const now = nowFrom(deps);
      const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS);

      // Checked before anything is uploaded; checked again inside the transaction.
      const isDemo = await db.adminUser.count({ where: { id: userId, role: UserRole.DEMO } });
      if (!isDemo) throw new NotDemoAccountError();

      // Files first, then rows (a row never points at a missing file). Product IDs are
      // chosen up front because the storage keys contain them.
      const items = DEMO_PRODUCTS.map((item) => ({ item, productId: crypto.randomUUID() }));
      const uploads = await Promise.allSettled(items.map(({ item, productId }) => storeSamplePhoto(item, productId)));
      const photos = uploads.map((upload) => (upload.status === "fulfilled" ? upload.value : null));
      const newKeys = photos.flatMap((photo) => (photo ? [photo.storageKey, photo.thumbKey] : []));
      const failedUpload = uploads.find((upload) => upload.status === "rejected");
      if (failedUpload) {
        await deletePhotoFiles(newKeys);
        throw failedUpload.reason;
      }

      let photoKeys: string[];
      try {
        photoKeys = await db.$transaction(async (tx) => {
          const user = await tx.adminUser.findFirst({ where: { id: userId, role: UserRole.DEMO }, select: { id: true } });
          if (!user) throw new NotDemoAccountError();

          const keys = await wipe(tx, userId);

          for (const [index, { item, productId }] of items.entries()) {
            const addedAt = daysAgo(item.addedDaysAgo);
            const photo = photos[index];
            const product = await tx.product.create({
              data: {
                id: productId,
                ownerId: userId,
                name: item.name,
                // The photo licenses require attribution, so the credit travels with the photo.
                description:
                  photo && item.photo ? `${item.description}\n\nPhoto: ${item.photo.credit}.` : item.description,
                ...(photo && {
                  images: {
                    create: {
                      id: photo.id,
                      storageKey: photo.storageKey,
                      thumbKey: photo.thumbKey,
                      width: photo.width,
                      height: photo.height,
                      sizeBytes: photo.sizeBytes,
                      position: 0,
                    },
                  },
                }),
                price: new Prisma.Decimal(item.price),
                currency: config.DEFAULT_CURRENCY,
                condition: item.condition,
                status: item.status,
                createdAt: addedAt,
                statusChanges: {
                  create: {
                    fromStatus: null,
                    // Sold items start as available; the sale below records the change to sold.
                    toStatus: item.sale ? "AVAILABLE" : item.status,
                    source: StatusChangeSource.SYSTEM,
                    reason: "Sample data",
                    createdAt: addedAt,
                  },
                },
                ...(item.ebayItemId && {
                  listing: {
                    create: {
                      ebayItemId: item.ebayItemId,
                      marketplaceId: config.EBAY_MARKETPLACE_ID,
                      title: item.name,
                      listingStatus: item.sale ? ListingStatus.ENDED : ListingStatus.ACTIVE,
                      listingUrl: null, // sample listings have no real eBay page
                      imageUrl: item.photo ? demoPictureUrl(item.photo.file) : null,
                    },
                  },
                }),
              },
              select: { id: true },
            });

            if (item.sale) {
              const soldAt = daysAgo(item.sale.soldDaysAgo);
              const sale = await tx.sale.create({
                data: {
                  productId: product.id,
                  ebayOrderId: item.sale.orderId,
                  ebayLineItemId: item.sale.lineItemId,
                  ebayItemId: item.ebayItemId ?? null,
                  soldPrice: new Prisma.Decimal(item.price),
                  currency: config.DEFAULT_CURRENCY,
                  soldAt,
                },
                select: { id: true },
              });
              await tx.productStatusChange.create({
                data: {
                  productId: product.id,
                  fromStatus: "AVAILABLE",
                  toStatus: "SOLD",
                  source: StatusChangeSource.EBAY_ORDER,
                  reason: "Sample sale",
                  saleId: sale.id,
                  createdAt: soldAt,
                },
              });
            }
          }

          // A fresh start also means the simulated eBay account is not connected yet.
          await tx.adminUser.update({ where: { id: userId }, data: { demoChangesUsed: 0, demoEbayConnectedAt: null } });
          return keys;
        });
      } catch (error) {
        // Nothing was saved, so the photos uploaded for this attempt belong to no one.
        await deletePhotoFiles(newKeys);
        throw error;
      }

      await deletePhotoFiles(photoKeys);
      log.info("Demo data restored", {
        products: DEMO_PRODUCTS.length,
        samplePhotos: newKeys.length / 2,
        photosRemoved: photoKeys.length / 2,
      });
    },

    /** Deletes every demo account together with its items, photos and sessions. */
    async removeAccounts(): Promise<number> {
      const users = await db.adminUser.findMany({ where: { role: UserRole.DEMO }, select: { id: true } });
      for (const user of users) {
        const photoKeys = await db.$transaction(async (tx) => {
          const keys = await wipe(tx, user.id);
          // Sessions cascade with the account.
          await tx.adminUser.deleteMany({ where: { id: user.id, role: UserRole.DEMO } });
          return keys;
        });
        await deletePhotoFiles(photoKeys);
      }
      return users.length;
    },

    /**
     * Takes one change from the demo allowance. Returns false when none is left.
     * A single conditional update, so parallel requests can't exceed the limit.
     */
    async reserveChange(userId: string): Promise<boolean> {
      const result = await db.adminUser.updateMany({
        where: { id: userId, role: UserRole.DEMO, demoChangesUsed: { lt: config.DEMO_CHANGE_LIMIT } },
        data: { demoChangesUsed: { increment: 1 } },
      });
      return result.count === 1;
    },

    /** Gives a reserved change back (the request it was reserved for did not succeed). */
    async refundChange(userId: string): Promise<void> {
      await db.adminUser.updateMany({
        where: { id: userId, role: UserRole.DEMO, demoChangesUsed: { gt: 0 } },
        data: { demoChangesUsed: { decrement: 1 } },
      });
    },
  };
}

export type DemoService = ReturnType<typeof createDemoService>;
