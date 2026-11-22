import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { AppError } from "../../common/errors.js";
import { errorBody, errorResponseSchema } from "../../common/http.js";
import { createRouter, type AppDeps, type AppEnv } from "../../common/router.js";
import { productIdParamSchema } from "../products/products.schemas.js";
import { createImagesService } from "./images.service.js";
import {
  imageIdParamSchema,
  MAX_UPLOAD_REQUEST_BYTES,
  productImageParamsSchema,
  productImageSchema,
  reorderImagesSchema,
} from "./images.schemas.js";

const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });
const errorContent = json(errorResponseSchema);
const security = [{ cookieAuth: [] }];
const tags = ["Product photos"];

const uploadRoute = createRoute({
  method: "post",
  path: "/products/{id}/images",
  tags,
  security,
  summary: "Upload one photo (multipart: `image` + `thumbnail`, both JPEG)",
  description:
    "The web app resizes photos before uploading: `image` (longest side ≤ 2048 px) and `thumbnail` (≤ 600 px). " +
    "The server verifies both are real JPEGs within the size limits and stores them privately.",
  request: {
    params: productIdParamSchema,
    body: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: z.object({
            image: z.any().openapi({ type: "string", format: "binary" }),
            thumbnail: z.any().openapi({ type: "string", format: "binary" }),
          }),
        },
      },
    },
  },
  responses: {
    201: { description: "Stored", content: json(z.object({ data: productImageSchema })) },
    400: { description: "Not a valid JPEG / bad request", content: errorContent },
    401: { description: "Not authenticated", content: errorContent },
    404: { description: "Product not found", content: errorContent },
    409: { description: "Photo limit reached", content: errorContent },
    413: { description: "File too large", content: errorContent },
  },
});

const viewResponses = {
  200: { description: "JPEG bytes", content: { "image/jpeg": { schema: z.any().openapi({ type: "string", format: "binary" }) } } },
  401: { description: "Not authenticated", content: errorContent },
  404: { description: "Not found", content: errorContent },
};

const fullRoute = createRoute({
  method: "get",
  path: "/images/{id}",
  tags,
  security,
  summary: "Full-size photo (requires the admin session)",
  request: { params: imageIdParamSchema },
  responses: viewResponses,
});

const thumbRoute = createRoute({
  method: "get",
  path: "/images/{id}/thumb",
  tags,
  security,
  summary: "Thumbnail (requires the admin session)",
  request: { params: imageIdParamSchema },
  responses: viewResponses,
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/products/{id}/images/{imageId}",
  tags,
  security,
  summary: "Delete a photo",
  request: { params: productImageParamsSchema },
  responses: {
    204: { description: "Deleted" },
    401: { description: "Not authenticated", content: errorContent },
    404: { description: "Not found", content: errorContent },
  },
});

const reorderRoute = createRoute({
  method: "put",
  path: "/products/{id}/images/order",
  tags,
  security,
  summary: "Set the photo order (first = main photo)",
  request: { params: productIdParamSchema, body: { required: true, content: json(reorderImagesSchema) } },
  responses: {
    200: { description: "New order", content: json(z.object({ data: z.array(productImageSchema) })) },
    400: { description: "Order doesn't match the product's photos", content: errorContent },
    401: { description: "Not authenticated", content: errorContent },
    404: { description: "Product not found", content: errorContent },
  },
});

/** A stored photo never changes (new upload = new ID), so browsers may keep it indefinitely. */
const IMAGE_CACHE_CONTROL = "private, max-age=31536000, immutable";

async function fileBytes(value: unknown, field: string): Promise<Uint8Array> {
  if (!(value instanceof File)) {
    throw new AppError(400, "INVALID_IMAGE", `Missing file field "${field}"`);
  }
  return new Uint8Array(await value.arrayBuffer());
}

export function createImageRoutes(deps: AppDeps) {
  const service = createImagesService(deps);
  const router = createRouter();

  router.use(
    "/products/:id/images",
    bodyLimit({
      maxSize: MAX_UPLOAD_REQUEST_BYTES,
      onError: (c) => c.json(errorBody("IMAGE_TOO_LARGE", "The upload is too large"), 413),
    }),
  );

  router.openapi(uploadRoute, async (c) => {
    const { id } = c.req.valid("param");
    let form: Record<string, unknown>;
    try {
      form = await c.req.parseBody();
    } catch {
      throw new AppError(400, "INVALID_IMAGE", "The upload could not be read");
    }
    const image = await service.add(
      c.get("admin").id,
      id,
      await fileBytes(form.image, "image"),
      await fileBytes(form.thumbnail, "thumbnail"),
    );
    return c.json({ data: image }, 201);
  });

  async function imageResponse(c: Context<AppEnv>, imageId: string, variant: "full" | "thumb") {
    const object = await service.open(c.get("admin").id, imageId, variant);
    const headers: Record<string, string> = {
      "Content-Type": object.contentType,
      "Cache-Control": IMAGE_CACHE_CONTROL,
      "Content-Disposition": "inline",
    };
    if (object.contentLength) headers["Content-Length"] = String(object.contentLength);
    return c.newResponse(object.body as ReadableStream<Uint8Array> | Uint8Array<ArrayBuffer>, 200, headers);
  }

  // The typed route helper expects JSON responses; these return raw image bytes.
  router.openapi(fullRoute, async (c) => (await imageResponse(c, c.req.valid("param").id, "full")) as never);
  router.openapi(thumbRoute, async (c) => (await imageResponse(c, c.req.valid("param").id, "thumb")) as never);

  router.openapi(deleteRoute, async (c) => {
    const { id, imageId } = c.req.valid("param");
    await service.remove(c.get("admin").id, id, imageId);
    return c.body(null, 204);
  });

  router.openapi(reorderRoute, async (c) =>
    c.json(
      { data: await service.reorder(c.get("admin").id, c.req.valid("param").id, c.req.valid("json").imageIds) },
      200,
    ),
  );

  return router;
}
