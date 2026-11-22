/**
 * Verifies the database-level guarantees that the business rules rely on
 * (duplicate-sale prevention, unambiguous listing mapping, history retention).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "../../src/generated/prisma/client.js";
import { createTestDatabase, prismaErrorCode, productData, resetDatabase } from "./helpers.js";

const db = createTestDatabase();

beforeEach(async () => {
  await resetDatabase(db);
});

afterAll(async () => {
  await db.$disconnect();
});

const saleData = (productId: string, overrides: Partial<Prisma.SaleUncheckedCreateInput> = {}) => ({
  productId,
  ebayOrderId: "12-34567-89012",
  ebayLineItemId: "10000000001",
  soldPrice: new Prisma.Decimal("99.90"),
  currency: "EUR",
  soldAt: new Date("2026-01-01T10:00:00Z"),
  ...overrides,
});

describe("Product", () => {
  it("defaults to AVAILABLE and stores price as an exact decimal", async () => {
    const product = await db.product.create({ data: productData({ price: new Prisma.Decimal("1234.56") }) });
    expect(product.status).toBe("AVAILABLE");
    expect(product.price.toString()).toBe("1234.56");
  });
});

describe("Sale", () => {
  it("rejects a second sale for the same eBay order line item", async () => {
    const product = await db.product.create({ data: productData() });
    await db.sale.create({ data: saleData(product.id) });

    expect(await prismaErrorCode(db.sale.create({ data: saleData(product.id) }))).toBe("P2002");
    expect(await db.sale.count()).toBe(1);
  });

  it("allows different line items of the same order", async () => {
    const a = await db.product.create({ data: productData() });
    const b = await db.product.create({ data: productData() });
    await db.sale.create({ data: saleData(a.id, { ebayLineItemId: "1" }) });
    await db.sale.create({ data: saleData(b.id, { ebayLineItemId: "2" }) });
    expect(await db.sale.count()).toBe(2);
  });

  it("prevents hard-deleting a product that has sales history", async () => {
    const product = await db.product.create({ data: productData() });
    await db.sale.create({ data: saleData(product.id) });

    expect(await prismaErrorCode(db.product.delete({ where: { id: product.id } }))).toBe("P2003");
    expect(await db.product.count()).toBe(1);
  });
});

describe("EbayListing", () => {
  it("maps an eBay item ID to at most one product", async () => {
    const a = await db.product.create({ data: productData() });
    const b = await db.product.create({ data: productData() });
    await db.ebayListing.create({ data: { productId: a.id, ebayItemId: "110012345678", marketplaceId: "EBAY_DE" } });

    const duplicate = db.ebayListing.create({
      data: { productId: b.id, ebayItemId: "110012345678", marketplaceId: "EBAY_US" },
    });
    expect(await prismaErrorCode(duplicate)).toBe("P2002");
  });

  it("allows only one listing per product", async () => {
    const product = await db.product.create({ data: productData() });
    await db.ebayListing.create({ data: { productId: product.id, ebayItemId: "1", marketplaceId: "EBAY_DE" } });

    const second = db.ebayListing.create({ data: { productId: product.id, ebayItemId: "2", marketplaceId: "EBAY_DE" } });
    expect(await prismaErrorCode(second)).toBe("P2002");
  });

  it("defaults listing status to UNKNOWN (never assumed active)", async () => {
    const product = await db.product.create({ data: productData() });
    const listing = await db.ebayListing.create({
      data: { productId: product.id, ebayItemId: "3", marketplaceId: "EBAY_DE" },
    });
    expect(listing.listingStatus).toBe("UNKNOWN");
  });
});

describe("EbayNotification", () => {
  it("stores a redelivered notification (same notificationId) only once", async () => {
    const data = { notificationId: "evt-1", topic: "ORDER_CONFIRMATION", payload: { orderId: "1" } };
    await db.ebayNotification.create({ data });
    expect(await prismaErrorCode(db.ebayNotification.create({ data }))).toBe("P2002");
  });

  it("starts as PENDING with zero attempts", async () => {
    const n = await db.ebayNotification.create({ data: { topic: "ORDER_CONFIRMATION", payload: {} } });
    expect(n.processingStatus).toBe("PENDING");
    expect(n.attempts).toBe(0);
  });
});

describe("ProductStatusChange", () => {
  it("keeps history linked to the sale that caused it", async () => {
    const product = await db.product.create({ data: productData() });
    const sale = await db.sale.create({ data: saleData(product.id) });
    await db.productStatusChange.create({
      data: { productId: product.id, fromStatus: "AVAILABLE", toStatus: "SOLD", source: "EBAY_ORDER", saleId: sale.id },
    });

    const history = await db.productStatusChange.findMany({ where: { productId: product.id }, include: { sale: true } });
    expect(history).toHaveLength(1);
    expect(history[0]?.sale?.ebayOrderId).toBe("12-34567-89012");
  });
});

describe("ReconciliationIssue", () => {
  it("records an unmatched line item only once per order line", async () => {
    const data = {
      type: "UNMATCHED_LINE_ITEM" as const,
      ebayOrderId: "o-1",
      ebayLineItemId: "l-1",
      ebayItemId: "999",
      message: "No product mapped to eBay item 999",
    };
    await db.reconciliationIssue.create({ data });
    expect(await prismaErrorCode(db.reconciliationIssue.create({ data }))).toBe("P2002");
  });
});
