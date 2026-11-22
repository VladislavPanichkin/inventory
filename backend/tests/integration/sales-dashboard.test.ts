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

async function seedSale(name: string, orderId: string, soldAt: string, saleStatus: "CONFIRMED" | "CANCELLED" = "CONFIRMED") {
  const product = await db.product.create({ data: productData({ name, status: "SOLD" }) });
  const sale = await db.sale.create({
    data: {
      productId: product.id,
      ebayOrderId: orderId,
      ebayLineItemId: `${orderId}-1`,
      soldPrice: new Prisma.Decimal("99.5"),
      currency: "EUR",
      soldAt: new Date(soldAt),
      saleStatus,
    },
  });
  return { product, sale };
}

describe("sales API", () => {
  it("lists sales newest first with product info, filters and searches", async () => {
    await seedSale("Leica camera", "11-111", "2026-01-01T10:00:00Z");
    await seedSale("Omega watch", "22-222", "2026-01-03T10:00:00Z", "CANCELLED");

    const all = await json(await api.get("/api/v1/sales"));
    expect(all.data.map((s: { ebayOrderId: string }) => s.ebayOrderId)).toEqual(["22-222", "11-111"]);
    expect(all.data[0]).toMatchObject({ soldPrice: "99.50", product: { name: "Omega watch" }, saleStatus: "CANCELLED" });
    expect(all.data[0].product).not.toHaveProperty("sku");
    expect(all.meta.total).toBe(2);

    const confirmed = await json(await api.get("/api/v1/sales?status=CONFIRMED"));
    expect(confirmed.data).toHaveLength(1);

    const byName = await json(await api.get("/api/v1/sales?search=leica"));
    expect(byName.data.map((s: { ebayOrderId: string }) => s.ebayOrderId)).toEqual(["11-111"]);
    const byOrder = await json(await api.get("/api/v1/sales?search=22-2"));
    expect(byOrder.data.map((s: { ebayOrderId: string }) => s.ebayOrderId)).toEqual(["22-222"]);
  });

  it("gets a sale and a product's sales history", async () => {
    const { product, sale } = await seedSale("Braun record player", "33-333", "2026-01-02T10:00:00Z");
    expect((await json(await api.get(`/api/v1/sales/${sale.id}`))).data.ebayLineItemId).toBe("33-333-1");
    expect((await json(await api.get(`/api/v1/products/${product.id}/sales`))).data).toHaveLength(1);
    expect((await api.get("/api/v1/products/00000000-0000-4000-8000-000000000000/sales")).status).toBe(404);
  });
});

describe("dashboard summary", () => {
  it("aggregates counts, recent sales and sync health", async () => {
    await db.product.create({ data: productData({ status: "AVAILABLE" }) });
    await db.product.create({ data: productData({ status: "ARCHIVED" }) });
    await seedSale("Nikon F2", "99-999", "2026-01-05T10:00:00Z");
    await db.reconciliationIssue.create({
      data: { type: "UNMATCHED_LINE_ITEM", ebayOrderId: "x", ebayLineItemId: "y", message: "unmatched" },
    });

    const { data } = await json(await api.get("/api/v1/dashboard/summary"));
    expect(data.products).toEqual({ total: 3, available: 1, reserved: 0, sold: 1, archived: 1 });
    expect(data.recentSales).toHaveLength(1);
    expect(data.ebay.connectionStatus).toBe("NOT_CONNECTED");
    expect(data.sync).toMatchObject({ lastSuccessfulSyncAt: null, openIssues: 1, failedNotifications: 0 });
    expect(data.warnings.map((w: { code: string }) => w.code)).toEqual(["EBAY_NOT_CONNECTED", "OPEN_ISSUES"]);
  });
});
