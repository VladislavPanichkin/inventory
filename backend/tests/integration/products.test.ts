import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "../../src/generated/prisma/client.js";
import { createTestApp, json, loginAsAdmin } from "./app-client.js";
import { createTestDatabase, productData, resetDatabase } from "./helpers.js";

const db = createTestDatabase();
let api: Awaited<ReturnType<typeof loginAsAdmin>>["api"];

beforeEach(async () => {
  await resetDatabase(db);
  ({ api } = await loginAsAdmin(db, createTestApp(db)));
});

afterAll(async () => {
  await db.$disconnect();
});

const newProduct = { name: "Leica M3", price: "1450.00", condition: "Used", description: "Clean" };

describe("product CRUD", () => {
  it("creates a product with defaults and an initial history entry", async () => {
    const res = await api.post("/api/v1/products", newProduct);
    expect(res.status).toBe(201);
    const { data } = await json(res);
    expect(data).toMatchObject({ name: "Leica M3", price: "1450.00", currency: "EUR", status: "AVAILABLE", listing: null });
    expect(data).not.toHaveProperty("sku");

    const history = await db.productStatusChange.findMany({ where: { productId: data.id } });
    expect(history).toMatchObject([{ fromStatus: null, toStatus: "AVAILABLE", source: "MANUAL" }]);
  });

  it("allows two unique items with the same name (identity is the product ID)", async () => {
    const a = await json(await api.post("/api/v1/products", newProduct));
    const b = await json(await api.post("/api/v1/products", newProduct));
    expect(a.data.id).not.toBe(b.data.id);
    expect(await db.product.count()).toBe(2);
  });

  it("returns field-level validation errors", async () => {
    const res = await api.post("/api/v1/products", { name: "", price: "abc" });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(["name", "price"]));
  });

  it("rejects an sku field as unknown input on update", async () => {
    const { data } = await json(await api.post("/api/v1/products", newProduct));
    expect((await api.patch(`/api/v1/products/${data.id}`, { sku: "X-1" })).status).toBe(400);
  });

  it("gets, updates (without touching status) and 404s", async () => {
    const { data: created } = await json(await api.post("/api/v1/products", newProduct));

    const got = await json(await api.get(`/api/v1/products/${created.id}`));
    expect(got.data.name).toBe("Leica M3");

    const updated = await json(await api.patch(`/api/v1/products/${created.id}`, { name: "Leica M3 (1957)", price: "1399.9", condition: "" }));
    expect(updated.data).toMatchObject({ name: "Leica M3 (1957)", price: "1399.90", condition: null, status: "AVAILABLE" });

    expect((await api.patch(`/api/v1/products/${created.id}`, { status: "SOLD" })).status).toBe(400);
    expect((await api.get("/api/v1/products/00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await api.get("/api/v1/products/not-a-uuid")).status).toBe(400);
  });

  it("deletes products without eBay history; refuses when sales or a listing exist", async () => {
    const { data: plain } = await json(await api.post("/api/v1/products", newProduct));
    expect((await api.delete(`/api/v1/products/${plain.id}`)).status).toBe(204);
    expect(await db.product.count()).toBe(0);

    const sold = await db.product.create({ data: productData({ status: "SOLD" }) });
    await db.sale.create({
      data: { productId: sold.id, ebayOrderId: "o", ebayLineItemId: "l", soldPrice: new Prisma.Decimal(1), currency: "EUR", soldAt: new Date() },
    });
    const res = await api.delete(`/api/v1/products/${sold.id}`);
    expect(res.status).toBe(409);
    expect((await json(res)).error.code).toBe("PRODUCT_HAS_HISTORY");

    const listed = await db.product.create({ data: productData() });
    await db.ebayListing.create({ data: { productId: listed.id, ebayItemId: "123", marketplaceId: "EBAY_DE" } });
    expect((await api.delete(`/api/v1/products/${listed.id}`)).status).toBe(409);
  });
});

describe("status management", () => {
  it("changes status manually and records history", async () => {
    const { data: p } = await json(await api.post("/api/v1/products", newProduct));

    const res = await api.patch(`/api/v1/products/${p.id}/status`, { status: "RESERVED", reason: "Customer pickup Friday" });
    expect(res.status).toBe(200);
    expect((await json(res)).data.status).toBe("RESERVED");

    const history = await json(await api.get(`/api/v1/products/${p.id}/status-history`));
    expect(history.data.map((h: { toStatus: string }) => h.toStatus)).toEqual(["RESERVED", "AVAILABLE"]);
    expect(history.data[0]).toMatchObject({ fromStatus: "AVAILABLE", source: "MANUAL", reason: "Customer pickup Friday" });
  });

  it("rejects no-op changes (409) and un-reasoned changes away from SOLD (400)", async () => {
    const { data: p } = await json(await api.post("/api/v1/products", newProduct));
    expect((await api.patch(`/api/v1/products/${p.id}/status`, { status: "AVAILABLE" })).status).toBe(409);

    await api.patch(`/api/v1/products/${p.id}/status`, { status: "SOLD" });
    const noReason = await api.patch(`/api/v1/products/${p.id}/status`, { status: "AVAILABLE" });
    expect(noReason.status).toBe(400);
    expect((await json(noReason)).error.code).toBe("REASON_REQUIRED");

    const withReason = await api.patch(`/api/v1/products/${p.id}/status`, { status: "AVAILABLE", reason: "Sale fell through" });
    expect(withReason.status).toBe(200);
  });

  it("archives a product (archive = status change, history kept)", async () => {
    const { data: p } = await json(await api.post("/api/v1/products", newProduct));
    await api.patch(`/api/v1/products/${p.id}/status`, { status: "ARCHIVED" });
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("ARCHIVED");
    expect(await db.productStatusChange.count({ where: { productId: p.id } })).toBe(2);
  });

  it("serialises concurrent status changes: exactly one wins, history stays consistent", async () => {
    const { data: p } = await json(await api.post("/api/v1/products", newProduct));
    const results = await Promise.all([
      api.patch(`/api/v1/products/${p.id}/status`, { status: "RESERVED" }),
      api.patch(`/api/v1/products/${p.id}/status`, { status: "ARCHIVED" }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    // Either both succeed sequentially (AVAILABLE->X->Y) or one is rejected as concurrent/no-op.
    const changes = await db.productStatusChange.findMany({ where: { productId: p.id }, orderBy: { createdAt: "asc" } });
    const final = await db.product.findUniqueOrThrow({ where: { id: p.id } });
    expect(changes.at(-1)!.toStatus).toBe(final.status);
    expect(changes.length).toBe(1 + statuses.filter((s) => s === 200).length);
  });
});

describe("listing products", () => {
  beforeEach(async () => {
    const rows = [
      { name: "Alpha camera", price: "30.00", status: "AVAILABLE" },
      { name: "Bravo watch", price: "10.00", status: "SOLD" },
      { name: "Charlie lamp", price: "20.00", status: "RESERVED" },
      { name: "Delta camera", price: "40.00", status: "ARCHIVED" },
    ] as const;
    for (const [i, row] of rows.entries()) {
      await db.product.create({
        data: productData({ ...row, price: new Prisma.Decimal(row.price), createdAt: new Date(Date.UTC(2026, 0, i + 1)) }),
      });
    }
    const alpha = await db.product.findFirstOrThrow({ where: { name: "Alpha camera" } });
    await db.ebayListing.create({ data: { productId: alpha.id, ebayItemId: "110099887766", marketplaceId: "EBAY_DE" } });
  });

  const names = async (query: string) =>
    (await json(await api.get(`/api/v1/products${query}`))).data.map((p: { name: string }) => p.name.split(" ")[0]);

  it("excludes archived by default, newest first", async () => {
    expect(await names("")).toEqual(["Charlie", "Bravo", "Alpha"]);
  });

  it("filters by status list and ALL", async () => {
    expect(await names("?status=SOLD,RESERVED&sort=name&order=asc")).toEqual(["Bravo", "Charlie"]);
    expect(await names("?status=ALL&sort=name&order=asc")).toEqual(["Alpha", "Bravo", "Charlie", "Delta"]);
    expect((await api.get("/api/v1/products?status=NOPE")).status).toBe(400);
  });

  it("searches name case-insensitively and eBay item ID exactly", async () => {
    expect(await names("?search=CAMERA&status=ALL&sort=name&order=asc")).toEqual(["Alpha", "Delta"]);
    expect(await names("?search=bravo")).toEqual(["Bravo"]);
    expect(await names("?search=110099887766")).toEqual(["Alpha"]);
    expect(await names("?search=11009988")).toEqual([]); // item ID must match exactly
  });

  it("sorts by price and paginates with metadata", async () => {
    const res = await json(await api.get("/api/v1/products?status=ALL&sort=price&order=asc&page=2&pageSize=3"));
    expect(res.data.map((p: { name: string }) => p.name)).toEqual(["Delta camera"]);
    expect(res.meta).toEqual({ page: 2, pageSize: 3, total: 4, totalPages: 2 });
  });

  it("includes the eBay listing summary", async () => {
    const res = await json(await api.get("/api/v1/products?search=Alpha"));
    expect(res.data[0].listing).toMatchObject({ ebayItemId: "110099887766", marketplaceId: "EBAY_DE", listingStatus: "UNKNOWN" });
  });
});
