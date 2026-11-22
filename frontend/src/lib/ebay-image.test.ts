import { describe, expect, it } from "vitest";
import { ebayImageSources, productCoverImage } from "@/lib/ebay-image";
import { imageFixture, productFixture } from "@/test/render";

const listing = (imageUrl: string | null) => ({
  id: "l1",
  ebayItemId: "125000000001",
  marketplaceId: "EBAY_DE",
  title: "Lamp",
  listingStatus: "ACTIVE" as const,
  listingUrl: null,
  imageUrl,
  lastSyncedAt: null,
});

describe("ebayImageSources", () => {
  it("asks for a larger picture and keeps the original as fallback", () => {
    expect(ebayImageSources("https://i.ebayimg.com/images/g/abc/s-l140.jpg", 500)).toEqual({
      src: "https://i.ebayimg.com/images/g/abc/s-l500.jpg",
      fallbackSrc: "https://i.ebayimg.com/images/g/abc/s-l140.jpg",
    });
    expect(ebayImageSources("https://i.ebayimg.com/images/g/abc/s-l64.webp?x=1", 1600).src).toBe(
      "https://i.ebayimg.com/images/g/abc/s-l1600.webp?x=1",
    );
  });

  it("leaves addresses without a size marker alone", () => {
    expect(ebayImageSources("https://i.ebayimg.com/00/s/abc/$_1.JPG", 500)).toEqual({
      src: "https://i.ebayimg.com/00/s/abc/$_1.JPG",
    });
    expect(ebayImageSources(null, 500)).toEqual({ src: null });
  });
});

describe("productCoverImage", () => {
  it("prefers the product's own photo", () => {
    const product = productFixture({ images: [imageFixture(1)], listing: listing("https://i.ebayimg.com/g/s-l140.jpg") });
    expect(productCoverImage(product)).toEqual({ src: imageFixture(1).thumbUrl });
  });

  it("falls back to eBay's picture, then to nothing", () => {
    expect(productCoverImage(productFixture({ listing: listing("https://i.ebayimg.com/g/s-l140.jpg") })).src).toBe(
      "https://i.ebayimg.com/g/s-l500.jpg",
    );
    expect(productCoverImage(productFixture({ listing: listing(null) }))).toEqual({ src: null });
    expect(productCoverImage(productFixture())).toEqual({ src: null });
  });
});
