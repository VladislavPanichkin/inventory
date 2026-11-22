import type { Product } from "@/lib/types";

/**
 * eBay reports a small preview picture for a listing (an address ending in e.g. `s-l140.jpg`).
 * The same picture is normally available larger by changing that size marker. This is an
 * observed convention of eBay's picture addresses, not a documented guarantee, so the
 * original address is always kept as a fallback in case the larger one doesn't load.
 */
const SIZE_MARKER = /\/s-l\d+(\.(?:jpe?g|png|webp))(\?.*)?$/i;

export interface ImageSources {
  src: string | null;
  fallbackSrc?: string | null;
}

export function ebayImageSources(url: string | null | undefined, size: 500 | 1600): ImageSources {
  if (!url) return { src: null };
  const larger = url.replace(SIZE_MARKER, `/s-l${size}$1$2`);
  return larger === url ? { src: url } : { src: larger, fallbackSrc: url };
}

/** Picture for a product card: its own main photo, otherwise eBay's picture of the listing. */
export function productCoverImage(product: Pick<Product, "images" | "listing">): ImageSources {
  const own = product.images[0]?.thumbUrl;
  return own ? { src: own } : ebayImageSources(product.listing?.imageUrl, 500);
}
