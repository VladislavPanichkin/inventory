import { API_PREFIX } from "../../common/api-prefix.js";
import { notFound } from "../../common/errors.js";
import { nowFrom, type AppDeps } from "../../common/router.js";
import { UserRole } from "../../generated/prisma/enums.js";
import type { EbayConnectionStatusDto } from "../ebay/ebay-account.service.js";
import { EbayNotConnectedError } from "../ebay/ebay-errors.js";
import { createEbayListingsService, type EbayListingDto, type ImportResult } from "../ebay/ebay-listings.service.js";
import type { EbayActiveListing } from "../ebay/ebay-trading.client.js";
import { DEMO_NEW_LISTINGS, DEMO_PRODUCTS, DEMO_SELLER_USERNAME } from "./demo-data.js";

/** eBay's refresh tokens last about 18 months; the simulated connection shows the same. */
const SIMULATED_AUTHORIZATION_MS = 548 * 24 * 60 * 60 * 1000;
const PICTURES_PATH = `${API_PREFIX}/demo/ebay/pictures`;
/** Sizes up to this many pixels are answered with the thumbnail file, larger ones with the full photo. */
const THUMBNAIL_MAX_PX = 600;

/**
 * Address of a sample listing's picture. It follows the shape of eBay's own picture
 * addresses (a size marker like `s-l140.jpg` at the end), so the web app treats it exactly
 * like a real eBay picture and asks for larger sizes the same way.
 */
export const demoPictureUrl = (file: string) => `${PICTURES_PATH}/${file}/s-l140.jpg`;

interface SampleListing extends EbayActiveListing {
  photo: { file: string; credit: string } | null;
}

/**
 * The simulated eBay for the demo account: a sample seller account with sample listings.
 *
 * Nothing here talks to eBay or touches the real eBay connection. The listing import itself
 * is the real one (`createEbayListingsService`), fed with the sample listings where the
 * real app would use eBay's answer, so the demo exercises the same import code.
 */
export function createDemoEbayService(deps: AppDeps) {
  const { db, config } = deps;
  const log = deps.logger.child({ module: "demo-ebay" });

  /** The sample account's active listings: sample items still for sale, plus the ones not in the inventory yet. */
  function sampleListings(): SampleListing[] {
    const base = { currency: config.DEFAULT_CURRENCY, listingUrl: null, listingType: "FixedPriceItem" };
    const fromInventory = DEMO_PRODUCTS.filter((item) => item.ebayItemId && !item.sale).map((item) => ({
      ...base,
      itemId: item.ebayItemId!,
      title: item.name,
      price: item.price,
      imageUrl: item.photo ? demoPictureUrl(item.photo.file) : null,
      quantityAvailable: 1,
      photo: item.photo ?? null,
    }));
    const notYetAdded = DEMO_NEW_LISTINGS.map((listing) => ({
      ...base,
      itemId: listing.itemId,
      title: listing.title,
      price: listing.price,
      imageUrl: demoPictureUrl(listing.photo.file),
      quantityAvailable: listing.quantityAvailable,
      photo: listing.photo,
    }));
    return [...fromInventory, ...notYetAdded];
  }

  const toActiveListing = ({ photo: _photo, ...listing }: SampleListing): EbayActiveListing => listing;

  // The real import, with the sample listings standing in for eBay. The token is never used.
  const listings = createEbayListingsService(
    deps,
    { getAccessToken: async () => "simulated" },
    { trading: { getActiveListings: async () => sampleListings().map(toActiveListing) } },
  );

  /** Only ever reads or writes a row with role DEMO. */
  const demoUser = (userId: string) => ({ id: userId, role: UserRole.DEMO });

  async function connectedAt(userId: string): Promise<Date | null> {
    const user = await db.adminUser.findFirst({ where: demoUser(userId), select: { demoEbayConnectedAt: true } });
    return user?.demoEbayConnectedAt ?? null;
  }

  async function requireConnected(userId: string) {
    if (!(await connectedAt(userId))) throw new EbayNotConnectedError();
  }

  async function status(userId: string): Promise<EbayConnectionStatusDto> {
    const since = await connectedAt(userId);
    return {
      configured: true,
      environment: "sandbox",
      connectionStatus: since ? "CONNECTED" : "NOT_CONNECTED",
      sellerUsername: since ? DEMO_SELLER_USERNAME : null,
      marketplaceId: config.EBAY_MARKETPLACE_ID,
      connectedAt: since?.toISOString() ?? null,
      refreshTokenExpiresAt: since ? new Date(since.getTime() + SIMULATED_AUTHORIZATION_MS).toISOString() : null,
      scopes: [],
      lastErrorMessage: null,
    };
  }

  return {
    status,

    /** Photo credits for the sample listings (the photo licenses require attribution next to the photos). */
    photoCredits(): string[] {
      return sampleListings().flatMap((listing) => (listing.photo ? [`${listing.title}: ${listing.photo.credit}`] : []));
    },

    async connect(userId: string): Promise<EbayConnectionStatusDto> {
      // Keeps the original time if already connected.
      await db.adminUser.updateMany({
        where: { ...demoUser(userId), demoEbayConnectedAt: null },
        data: { demoEbayConnectedAt: nowFrom(deps) },
      });
      return status(userId);
    },

    async disconnect(userId: string): Promise<EbayConnectionStatusDto> {
      await db.adminUser.updateMany({ where: demoUser(userId), data: { demoEbayConnectedAt: null } });
      return status(userId);
    },

    async listActive(userId: string): Promise<EbayListingDto[]> {
      await requireConnected(userId);
      return listings.listActive(userId);
    },

    async importListings(userId: string, itemIds?: string[]): Promise<ImportResult> {
      await requireConnected(userId);
      const result = await listings.importListings(userId, itemIds);

      // An imported listing shows eBay's picture; here that is a sample photo, so its credit goes along.
      const samples = new Map(sampleListings().map((listing) => [listing.itemId, listing]));
      for (const { itemId, productId } of result.created) {
        const credit = samples.get(itemId)?.photo?.credit;
        if (!credit) continue;
        await db.product.updateMany({
          where: { id: productId, owner: demoUser(userId) },
          data: { description: `Photo: ${credit}.` },
        });
      }
      log.info("Sample listings added", { created: result.created.length, skipped: result.skipped.length });
      return result;
    },

    /** A sample listing's picture. Only photos that belong to a sample listing are served. */
    async openPicture(file: string, sizePx: number): Promise<Uint8Array> {
      const known = sampleListings().some((listing) => listing.photo?.file === file);
      const bytes = known
        ? await deps.demoPhotos?.(sizePx <= THUMBNAIL_MAX_PX ? `${file}_thumb.jpg` : `${file}.jpg`)
        : null;
      if (!bytes) throw notFound("Picture");
      return bytes;
    },
  };
}

export type DemoEbayService = ReturnType<typeof createDemoEbayService>;
