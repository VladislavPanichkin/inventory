import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createMemoryImageStorage } from "../../src/infrastructure/image-storage.js";
import { MAX_FULL_BYTES, MAX_IMAGES_PER_PRODUCT } from "../../src/modules/images/images.schemas.js";
import { makeJpeg, PNG_BYTES } from "../support/jpeg.js";
import { client, createTestApp, json, loginAsAdmin } from "./app-client.js";
import { createTestDatabase, productData, resetDatabase } from "./helpers.js";

const db = createTestDatabase();
let storage: ReturnType<typeof createMemoryImageStorage>;
let app: ReturnType<typeof createTestApp>;
let api: Awaited<ReturnType<typeof loginAsAdmin>>["api"];
let productId: string;

const full = makeJpeg(2048, 1536, 300_000);
const thumb = makeJpeg(600, 450, 30_000);

beforeEach(async () => {
  await resetDatabase(db);
  storage = createMemoryImageStorage();
  app = createTestApp(db, { imageStorage: storage });
  ({ api } = await loginAsAdmin(db, app));
  productId = (await db.product.create({ data: productData({ name: "Leica M3" }) })).id;
});

afterAll(async () => {
  await db.$disconnect();
});

const upload = (id = productId, files: Record<string, Uint8Array> = { image: full, thumbnail: thumb }) =>
  api.upload(`/api/v1/products/${id}/images`, files);

describe("uploading photos", () => {
  it("stores the photo and thumbnail privately and returns their URLs", async () => {
    const res = await upload();
    expect(res.status).toBe(201);
    const { data } = await json(res);
    expect(data).toMatchObject({ width: 2048, height: 1536, sizeBytes: full.byteLength, position: 0 });
    expect(data.url).toBe(`/api/v1/images/${data.id}`);
    expect(data.thumbUrl).toBe(`/api/v1/images/${data.id}/thumb`);

    // Two objects under unguessable, product-scoped keys.
    expect([...storage.objects.keys()].sort()).toEqual([
      `products/${productId}/${data.id}.jpg`,
      `products/${productId}/${data.id}_thumb.jpg`,
    ]);
    expect(storage.objects.get(`products/${productId}/${data.id}.jpg`)?.contentType).toBe("image/jpeg");
  });

  it("appends further photos in order and lists them on the product, main photo first", async () => {
    const first = (await json(await upload())).data;
    const second = (await json(await upload())).data;
    expect(second.position).toBe(1);

    const product = (await json(await api.get(`/api/v1/products/${productId}`))).data;
    expect(product.images.map((i: { id: string }) => i.id)).toEqual([first.id, second.id]);
    expect(product).not.toHaveProperty("imageUrl");

    const list = (await json(await api.get("/api/v1/products"))).data;
    expect(list[0].images[0].thumbUrl).toBe(first.thumbUrl);
  });

  it("rejects files that are not real JPEGs, whatever they are named", async () => {
    for (const files of [
      { image: PNG_BYTES, thumbnail: thumb },
      { image: full, thumbnail: new TextEncoder().encode("<svg onload=alert(1)>") },
      { image: new Uint8Array(), thumbnail: thumb },
    ]) {
      const res = await upload(productId, files);
      expect(res.status).toBe(400);
      expect((await json(res)).error.code).toBe("INVALID_IMAGE");
    }
    expect(storage.objects.size).toBe(0);
    expect(await db.productImage.count()).toBe(0);
  });

  it("rejects missing fields, oversized files and oversized dimensions", async () => {
    expect((await upload(productId, { image: full })).status).toBe(400);
    expect((await upload(productId, { image: makeJpeg(2048, 1536, MAX_FULL_BYTES + 1000), thumbnail: thumb })).status).toBe(413);
    const huge = await upload(productId, { image: makeJpeg(9000, 100), thumbnail: thumb });
    expect(huge.status).toBe(400);
    expect((await json(huge)).error.message).toMatch(/4096 pixels/);
    expect(storage.objects.size).toBe(0);
  });

  it("enforces the per-product limit", async () => {
    await db.productImage.createMany({
      data: Array.from({ length: MAX_IMAGES_PER_PRODUCT }, (_, i) => ({
        productId,
        storageKey: `seed/${i}.jpg`,
        thumbKey: `seed/${i}_thumb.jpg`,
        width: 1,
        height: 1,
        sizeBytes: 1,
        position: i,
      })),
    });
    const res = await upload();
    expect(res.status).toBe(409);
    expect((await json(res)).error.code).toBe("TOO_MANY_IMAGES");
    expect(storage.objects.size).toBe(0);
  });

  it("requires a session, the CSRF header and an existing product", async () => {
    expect((await client(app).upload(`/api/v1/products/${productId}/images`, { image: full, thumbnail: thumb })).status).toBe(401);

    const form = new FormData();
    form.append("image", new File([full as Uint8Array<ArrayBuffer>], "a.jpg"));
    const noCsrf = await app.request(`http://localhost/api/v1/products/${productId}/images`, { method: "POST", body: form });
    expect(noCsrf.status).toBe(403);

    expect((await upload("00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect(storage.objects.size).toBe(0);
  });
});

describe("viewing photos", () => {
  it("serves the bytes to a logged-in admin with long-lived private caching", async () => {
    const image = (await json(await upload())).data;

    const fullRes = await api.get(image.url);
    expect(fullRes.status).toBe(200);
    expect(fullRes.headers.get("content-type")).toBe("image/jpeg");
    expect(fullRes.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(fullRes.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await fullRes.arrayBuffer())).toEqual(full);

    const thumbRes = await api.get(image.thumbUrl);
    expect(new Uint8Array(await thumbRes.arrayBuffer())).toEqual(thumb);
  });

  it("is not reachable without a session and 404s for unknown photos", async () => {
    const image = (await json(await upload())).data;
    expect((await client(app).get(image.url)).status).toBe(401);
    expect((await client(app).get(image.thumbUrl)).status).toBe(401);
    expect((await api.get("/api/v1/images/00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await api.get("/api/v1/images/not-a-uuid")).status).toBe(400);
  });
});

describe("managing photos", () => {
  it("deletes a photo's row and both stored files", async () => {
    const keep = (await json(await upload())).data;
    const remove = (await json(await upload())).data;

    expect((await api.delete(`/api/v1/products/${productId}/images/${remove.id}`)).status).toBe(204);
    expect(await db.productImage.count()).toBe(1);
    expect([...storage.objects.keys()].every((key) => key.includes(keep.id))).toBe(true);
    expect((await api.get(remove.url)).status).toBe(404);
    // Wrong product for this image
    const other = await db.product.create({ data: productData() });
    expect((await api.delete(`/api/v1/products/${other.id}/images/${keep.id}`)).status).toBe(404);
  });

  it("reorders photos: the first ID becomes the main photo", async () => {
    const a = (await json(await upload())).data;
    const b = (await json(await upload())).data;
    const c = (await json(await upload())).data;

    const res = await api.put(`/api/v1/products/${productId}/images/order`, { imageIds: [c.id, a.id, b.id] });
    expect(res.status).toBe(200);
    expect((await json(res)).data.map((i: { id: string }) => i.id)).toEqual([c.id, a.id, b.id]);

    const product = (await json(await api.get(`/api/v1/products/${productId}`))).data;
    expect(product.images[0].id).toBe(c.id);
  });

  it("rejects an order that doesn't list every photo exactly once", async () => {
    const a = (await json(await upload())).data;
    const b = (await json(await upload())).data;
    for (const imageIds of [[a.id], [a.id, a.id], [a.id, b.id, "00000000-0000-4000-8000-000000000000"]]) {
      const res = await api.put(`/api/v1/products/${productId}/images/order`, { imageIds });
      expect(res.status, JSON.stringify(imageIds)).toBe(400);
    }
  });

  it("removes a product's photo files when the product is deleted", async () => {
    await upload();
    await upload();
    expect(storage.objects.size).toBe(4);

    expect((await api.delete(`/api/v1/products/${productId}`)).status).toBe(204);
    expect(storage.objects.size).toBe(0);
    expect(await db.productImage.count()).toBe(0);
  });

  it("cleans up stored files if saving the database row fails", async () => {
    const failing = createTestApp(db, {
      imageStorage: {
        ...storage,
        put: async (key, bytes, type) => {
          if (key.endsWith("_thumb.jpg")) throw new Error("storage down");
          return storage.put(key, bytes, type);
        },
      },
    });
    const { api: failingApi } = await loginAsAdmin(db, failing);
    const res = await failingApi.upload(`/api/v1/products/${productId}/images`, { image: full, thumbnail: thumb });
    expect(res.status).toBe(500);
    expect(storage.objects.size).toBe(0); // the already-stored full image was removed again
    expect(await db.productImage.count()).toBe(0);
  });
});
