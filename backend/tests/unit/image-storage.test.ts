import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { imageStorageKind, loadConfig } from "../../src/config/env.js";
import {
  assertValidKey,
  createMemoryImageStorage,
  createS3ImageStorage,
  ImageStorageError,
  type StoredObject,
} from "../../src/infrastructure/image-storage.js";
import { createLocalImageStorage } from "../../src/infrastructure/image-storage.local.js";

async function bytesOf(object: StoredObject | null): Promise<Uint8Array | null> {
  if (!object) return null;
  if (object.body instanceof Uint8Array) return object.body;
  return new Uint8Array(await new Response(object.body).arrayBuffer());
}

const data = new Uint8Array([1, 2, 3, 4]);

describe("S3 image storage", () => {
  function setup(respond: (request: Request) => Response | Promise<Response>) {
    const requests: Request[] = [];
    const storage = createS3ImageStorage({
      endpoint: "https://t3.storageapi.dev",
      region: "ams",
      bucket: "inventory-photos-abc123",
      accessKeyId: "test-key-id",
      secretAccessKey: "test-secret",
      fetch: (async (input: string | URL | Request) => {
        const request = input as Request;
        requests.push(request.clone());
        return respond(request);
      }) as typeof fetch,
    });
    return { storage, requests };
  }

  it("uploads with a signed PUT to the bucket's virtual-hosted URL", async () => {
    const { storage, requests } = setup(() => new Response(null, { status: 200 }));
    await storage.put("products/p1/img.jpg", data, "image/jpeg");

    const [request] = requests;
    expect(request!.method).toBe("PUT");
    expect(request!.url).toBe("https://inventory-photos-abc123.t3.storageapi.dev/products/p1/img.jpg");
    expect(request!.headers.get("content-type")).toBe("image/jpeg");
    expect(request!.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=test-key-id\/\d{8}\/ams\/s3\/aws4_request/);
    expect(request!.headers.get("authorization")).not.toContain("test-secret");
    expect(new Uint8Array(await request!.arrayBuffer())).toEqual(data);
  });

  it("downloads objects and returns null for missing ones", async () => {
    const { storage } = setup((request) =>
      request.url.endsWith("/missing.jpg")
        ? new Response("NoSuchKey", { status: 404 })
        : new Response(data, { status: 200, headers: { "Content-Length": "4" } }),
    );
    const found = await storage.get("products/p1/img.jpg");
    expect(await bytesOf(found)).toEqual(data);
    expect(found?.contentLength).toBe(4);
    expect(await storage.get("products/p1/missing.jpg")).toBeNull();
  });

  it("deletes each key and tolerates already-missing objects", async () => {
    const { storage, requests } = setup(() => new Response(null, { status: 204 }));
    await storage.delete(["a/1.jpg", "a/2.jpg"]);
    expect(requests.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual(["DELETE /a/1.jpg", "DELETE /a/2.jpg"]);
  });

  it("reports rejected uploads and unreachable storage as storage errors", async () => {
    const rejected = setup(() => new Response("AccessDenied", { status: 403 }));
    await expect(rejected.storage.put("a/1.jpg", data, "image/jpeg")).rejects.toMatchObject({ name: "ImageStorageError", status: 403 });

    const down = setup(() => {
      throw new TypeError("fetch failed");
    });
    await expect(down.storage.get("a/1.jpg")).rejects.toBeInstanceOf(ImageStorageError);
  });
});

describe("local image storage", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "inventory-images-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const storage = createLocalImageStorage(dir);

  it("stores, reads and deletes files in nested folders", async () => {
    await storage.put("products/p1/img.jpg", data, "image/jpeg");
    expect(await bytesOf(await storage.get("products/p1/img.jpg"))).toEqual(data);

    await storage.delete(["products/p1/img.jpg", "products/p1/never-existed.jpg"]);
    expect(await storage.get("products/p1/img.jpg")).toBeNull();
  });

  it("refuses keys that could escape the storage folder", async () => {
    for (const key of ["../outside.jpg", "products/../../etc/passwd", "/abs.jpg", "a//b.jpg", "a b.jpg"]) {
      await expect(storage.put(key, data, "image/jpeg"), key).rejects.toThrow();
    }
  });
});

describe("memory image storage and key validation", () => {
  it("round-trips and isolates stored bytes from later mutation", async () => {
    const storage = createMemoryImageStorage();
    const original = new Uint8Array([9, 9]);
    await storage.put("k/1.jpg", original, "image/jpeg");
    original[0] = 0;
    expect(await bytesOf(await storage.get("k/1.jpg"))).toEqual(new Uint8Array([9, 9]));
    await storage.delete(["k/1.jpg"]);
    expect(storage.objects.size).toBe(0);
  });

  it("accepts server-generated keys only", () => {
    expect(() => assertValidKey("products/6f1c2b9e-0000-4000-8000-000000000000/a_thumb.jpg")).not.toThrow();
    expect(() => assertValidKey("../x")).toThrow(ImageStorageError);
    expect(() => assertValidKey("")).toThrow(ImageStorageError);
  });
});

describe("photo storage configuration", () => {
  const base = { DATABASE_URL: "postgresql://u:p@localhost:5432/db" };
  const s3 = {
    S3_ENDPOINT: "https://t3.storageapi.dev",
    S3_REGION: "ams",
    S3_BUCKET: "b",
    S3_ACCESS_KEY_ID: "k",
    S3_SECRET_ACCESS_KEY: "s",
  };
  const prod = { ...base, NODE_ENV: "production", FRONTEND_URL: "https://x.example.com", TOKEN_ENCRYPTION_KEY: btoa("x".repeat(32)) };

  it("uses the bucket when fully configured, a local folder otherwise", () => {
    expect(imageStorageKind(loadConfig(base))).toBe("local");
    expect(imageStorageKind(loadConfig({ ...base, ...s3 }))).toBe("s3");
    expect(imageStorageKind(loadConfig({ ...base, ...s3, IMAGE_STORAGE: "local" }))).toBe("local");
  });

  it("refuses to start production without photo storage (a container disk is wiped on deploy)", () => {
    expect(() => loadConfig(prod)).toThrow(/photo storage is required in production/);
    expect(() => loadConfig({ ...prod, ...s3, S3_SECRET_ACCESS_KEY: "" })).toThrow(/photo storage is required/);
    expect(imageStorageKind(loadConfig({ ...prod, ...s3 }))).toBe("s3");
    expect(imageStorageKind(loadConfig({ ...prod, IMAGE_STORAGE: "local" }))).toBe("local");
  });

  it("rejects IMAGE_STORAGE=s3 with incomplete credentials", () => {
    expect(() => loadConfig({ ...base, IMAGE_STORAGE: "s3" })).toThrow(/IMAGE_STORAGE=s3 requires/);
  });
});
