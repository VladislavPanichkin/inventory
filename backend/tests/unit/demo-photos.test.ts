import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createDemoPhotoFiles } from "../../src/infrastructure/demo-photo-files.js";
import { DEMO_NEW_LISTINGS, DEMO_PRODUCTS } from "../../src/modules/demo/demo-data.js";
import { MAX_FULL_BYTES, MAX_FULL_SIDE_PX, MAX_THUMB_BYTES, MAX_THUMB_SIDE_PX } from "../../src/modules/images/images.schemas.js";
import { readJpegInfo } from "../../src/modules/images/jpeg.js";

const PHOTO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../assets/demo-photos");

describe("bundled sample photos", () => {
  const read = createDemoPhotoFiles(PHOTO_DIR);

  /** Sample items and sample eBay listings alike: everything that names a bundled photo. */
  const all = [...DEMO_PRODUCTS.map((item) => ({ name: item.name, photo: item.photo })), ...DEMO_NEW_LISTINGS.map((listing) => ({ name: listing.title, photo: listing.photo }))];

  it("exist for every sample item and listing and fit the normal upload limits", async () => {
    for (const item of all) {
      expect(item.photo, item.name).toBeDefined();
      const full = await read(`${item.photo!.file}.jpg`);
      const thumb = await read(`${item.photo!.file}_thumb.jpg`);
      expect(full, `${item.photo!.file}.jpg`).not.toBeNull();
      expect(thumb, `${item.photo!.file}_thumb.jpg`).not.toBeNull();

      const fullInfo = readJpegInfo(full!)!;
      const thumbInfo = readJpegInfo(thumb!)!;
      expect(Math.max(fullInfo.width, fullInfo.height)).toBeLessThanOrEqual(MAX_FULL_SIDE_PX);
      expect(Math.max(thumbInfo.width, thumbInfo.height)).toBeLessThanOrEqual(MAX_THUMB_SIDE_PX);
      expect(full!.byteLength).toBeLessThanOrEqual(MAX_FULL_BYTES);
      expect(thumb!.byteLength).toBeLessThanOrEqual(MAX_THUMB_BYTES);
    }
  });

  it("have a credit for every photo", () => {
    for (const item of all) {
      expect(item.photo!.credit).toMatch(/^.+, (CC0|public domain|CC BY(-SA)? \d\.\d), via Wikimedia Commons$/);
    }

    // Every bundled photo is used, and each is used once.
    const files = all.map((item) => item.photo!.file);
    expect(new Set(files).size).toBe(files.length);
  });

  it("returns null for a file that isn't there", async () => {
    expect(await read("no-such-photo.jpg")).toBeNull();
  });

  it("only ever reads plain photo names from its folder", async () => {
    for (const name of ["../../package.json", "/etc/hosts", "leica-m3.jpg/../../../package.json", "CREDITS.md", "..", ""]) {
      expect(await read(name)).toBeNull();
    }
  });
});
