import { AppError, notFound } from "../../common/errors.js";
import type { AppDeps } from "../../common/router.js";
import { readJpegInfo } from "./jpeg.js";
import {
  imageOrder,
  MAX_FULL_BYTES,
  MAX_FULL_SIDE_PX,
  MAX_IMAGES_PER_PRODUCT,
  MAX_THUMB_BYTES,
  MAX_THUMB_SIDE_PX,
  toProductImageDto,
} from "./images.schemas.js";

const JPEG = "image/jpeg";

const invalidImage = (message: string) => new AppError(400, "INVALID_IMAGE", message);
const tooManyImages = () =>
  new AppError(409, "TOO_MANY_IMAGES", `A product can have at most ${MAX_IMAGES_PER_PRODUCT} photos`);

/** Validates that the bytes are a real JPEG within the allowed size, returning its dimensions. */
function inspect(bytes: Uint8Array, label: string, maxBytes: number, maxSide: number) {
  if (bytes.byteLength === 0) throw invalidImage(`The ${label} is empty`);
  if (bytes.byteLength > maxBytes) {
    throw new AppError(413, "IMAGE_TOO_LARGE", `The ${label} is larger than ${Math.round(maxBytes / 1024)} KB`);
  }
  const info = readJpegInfo(bytes);
  if (!info) throw invalidImage(`The ${label} is not a valid JPEG image`);
  if (Math.max(info.width, info.height) > maxSide) {
    throw invalidImage(`The ${label} is larger than ${maxSide} pixels on its longest side`);
  }
  return info;
}

/**
 * Product photos: validation, object storage and database rows.
 * Each photo is two JPEG objects (full size + thumbnail) under an unguessable key.
 * Every method is limited to photos of the signed-in account's own products (`ownerId`).
 */
export function createImagesService(deps: AppDeps) {
  const { db, imageStorage: storage } = deps;
  const log = deps.logger.child({ module: "images" });

  /** Removes objects after their rows are gone. Failures only leave orphans, so they're logged, not thrown. */
  async function deleteObjects(keys: string[]) {
    if (keys.length === 0) return;
    try {
      await storage.delete(keys);
    } catch (error) {
      log.error("Could not delete photo objects (orphaned in storage)", { keys, error });
    }
  }

  return {
    deleteObjects,

    async add(ownerId: string, productId: string, full: Uint8Array, thumbnail: Uint8Array) {
      const info = inspect(full, "photo", MAX_FULL_BYTES, MAX_FULL_SIDE_PX);
      inspect(thumbnail, "thumbnail", MAX_THUMB_BYTES, MAX_THUMB_SIDE_PX);

      const product = await db.product.findFirst({ where: { id: productId, ownerId }, select: { id: true } });
      if (!product) throw notFound("Product", productId);
      if ((await db.productImage.count({ where: { productId } })) >= MAX_IMAGES_PER_PRODUCT) throw tooManyImages();

      const id = crypto.randomUUID();
      const storageKey = `products/${productId}/${id}.jpg`;
      const thumbKey = `products/${productId}/${id}_thumb.jpg`;

      // Objects first, then the row: a row never points at a missing file.
      await storage.put(storageKey, full, JPEG);
      try {
        await storage.put(thumbKey, thumbnail, JPEG);
        const image = await db.$transaction(async (tx) => {
          const existing = await tx.productImage.aggregate({
            where: { productId },
            _count: { _all: true },
            _max: { position: true },
          });
          // Re-checked inside the transaction so parallel uploads can't exceed the limit.
          if (existing._count._all >= MAX_IMAGES_PER_PRODUCT) throw tooManyImages();
          return tx.productImage.create({
            data: {
              id,
              productId,
              storageKey,
              thumbKey,
              width: info.width,
              height: info.height,
              sizeBytes: full.byteLength,
              position: (existing._max.position ?? -1) + 1,
            },
          });
        });
        log.info("Photo added", { productId, imageId: id, sizeBytes: full.byteLength });
        return toProductImageDto(image);
      } catch (error) {
        await deleteObjects([storageKey, thumbKey]);
        throw error;
      }
    },

    /** Opens the stored bytes of a photo for streaming to the (authenticated) browser. */
    async open(ownerId: string, imageId: string, variant: "full" | "thumb") {
      const image = await db.productImage.findFirst({ where: { id: imageId, product: { ownerId } } });
      if (!image) throw notFound("Image", imageId);
      const object = await storage.get(variant === "full" ? image.storageKey : image.thumbKey);
      if (!object) {
        log.error("Photo row exists but its object is missing", { imageId, variant });
        throw notFound("Image", imageId);
      }
      return { ...object, contentType: JPEG };
    },

    async remove(ownerId: string, productId: string, imageId: string) {
      const image = await db.productImage.findFirst({ where: { id: imageId, productId, product: { ownerId } } });
      if (!image) throw notFound("Image", imageId);
      await db.productImage.delete({ where: { id: image.id } });
      await deleteObjects([image.storageKey, image.thumbKey]);
      log.info("Photo deleted", { productId, imageId });
    },

    /** Sets the photo order; the first ID becomes the main photo. Must list every photo exactly once. */
    async reorder(ownerId: string, productId: string, imageIds: string[]) {
      return db.$transaction(async (tx) => {
        const current = await tx.productImage.findMany({
          where: { productId, product: { ownerId } },
          select: { id: true },
        });
        if (current.length === 0) {
          const exists = await tx.product.count({ where: { id: productId, ownerId } });
          if (!exists) throw notFound("Product", productId);
        }
        const currentIds = new Set(current.map((image) => image.id));
        const unique = new Set(imageIds);
        if (unique.size !== imageIds.length || unique.size !== currentIds.size || imageIds.some((id) => !currentIds.has(id))) {
          throw new AppError(400, "INVALID_IMAGE_ORDER", "The order must list each of the product's photos exactly once");
        }
        for (const [position, id] of imageIds.entries()) {
          await tx.productImage.update({ where: { id }, data: { position } });
        }
        const images = await tx.productImage.findMany({ where: { productId }, orderBy: imageOrder });
        return images.map(toProductImageDto);
      });
    },
  };
}

export type ImagesService = ReturnType<typeof createImagesService>;
