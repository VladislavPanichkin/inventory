import { z } from "@hono/zod-openapi";
import { API_PREFIX } from "../../common/api-prefix.js";
import type { ProductImage } from "../../generated/prisma/client.js";

/** eBay allows up to 24 photos per listing; matching it keeps the later push-to-eBay stage simple. */
export const MAX_IMAGES_PER_PRODUCT = 24;
/** The app resizes before uploading (≈0.3–0.8 MB); these are generous ceilings. */
export const MAX_FULL_BYTES = 5 * 1024 * 1024;
export const MAX_THUMB_BYTES = 512 * 1024;
export const MAX_FULL_SIDE_PX = 4096;
export const MAX_THUMB_SIDE_PX = 1024;
/** Whole multipart request (full image + thumbnail + form overhead). */
export const MAX_UPLOAD_REQUEST_BYTES = MAX_FULL_BYTES + MAX_THUMB_BYTES + 64 * 1024;

export const productImageSchema = z
  .object({
    id: z.string().uuid(),
    /** Full-size photo (longest side ≤ 2048 px as produced by the app). */
    url: z.string(),
    /** Small version for lists. */
    thumbUrl: z.string(),
    width: z.number().int(),
    height: z.number().int(),
    sizeBytes: z.number().int(),
    position: z.number().int(),
    createdAt: z.string(),
  })
  .openapi("ProductImage");

export type ProductImageDto = z.infer<typeof productImageSchema>;

export function toProductImageDto(image: ProductImage): ProductImageDto {
  return {
    id: image.id,
    url: `${API_PREFIX}/images/${image.id}`,
    thumbUrl: `${API_PREFIX}/images/${image.id}/thumb`,
    width: image.width,
    height: image.height,
    sizeBytes: image.sizeBytes,
    position: image.position,
    createdAt: image.createdAt.toISOString(),
  };
}

/** Prisma ordering that defines "main photo first". */
export const imageOrder = [{ position: "asc" as const }, { createdAt: "asc" as const }];

export const imageIdParamSchema = z.object({
  id: z.string().uuid().openapi({ param: { name: "id", in: "path" } }),
});

export const productImageParamsSchema = z.object({
  id: z.string().uuid().openapi({ param: { name: "id", in: "path" } }),
  imageId: z.string().uuid().openapi({ param: { name: "imageId", in: "path" } }),
});

export const reorderImagesSchema = z
  .object({
    imageIds: z.array(z.string().uuid()).min(1).max(MAX_IMAGES_PER_PRODUCT),
  })
  .openapi("ReorderProductImagesRequest");
