import { describe, expect, it } from "vitest";
import { createProductSchema, listProductsQuerySchema, updateProductSchema } from "../../src/modules/products/products.schemas.js";
import { buildProductWhere } from "../../src/modules/products/products.service.js";

describe("buildProductWhere", () => {
  const ownerId = "owner-1";

  it("hides archived products by default", () => {
    expect(buildProductWhere(ownerId, {})).toEqual({ ownerId, status: { not: "ARCHIVED" } });
  });

  it("is always limited to the owner's items, whatever the filter", () => {
    for (const query of [{}, { status: "ALL" }, { status: "SOLD" }, { search: "x" }, { search: "x", status: "ALL" }]) {
      expect(buildProductWhere(ownerId, query)).toMatchObject({ ownerId });
    }
  });

  it("supports ALL and comma-separated status lists", () => {
    expect(buildProductWhere(ownerId, { status: "ALL" })).toEqual({ ownerId });
    expect(buildProductWhere(ownerId, { status: "AVAILABLE, SOLD" })).toEqual({
      ownerId,
      status: { in: ["AVAILABLE", "SOLD"] },
    });
  });

  it("searches name case-insensitively and eBay item ID exactly", () => {
    expect(buildProductWhere(ownerId, { search: "leica", status: "ALL" })).toEqual({
      ownerId,
      OR: [
        { name: { contains: "leica", mode: "insensitive" } },
        { listing: { ebayItemId: "leica" } },
      ],
    });
  });
});

describe("product input schemas", () => {
  it("applies list defaults and rejects unknown statuses", () => {
    expect(listProductsQuerySchema.parse({})).toMatchObject({ page: 1, pageSize: 20, sort: "createdAt", order: "desc" });
    expect(listProductsQuerySchema.safeParse({ status: "AVAILABLE,BOGUS" }).success).toBe(false);
    expect(listProductsQuerySchema.safeParse({ pageSize: "500" }).success).toBe(false);
  });

  it("normalises create input", () => {
    const parsed = createProductSchema.parse({ name: " Leica ", price: 12.5, currency: "eur", description: "" });
    expect(parsed).toMatchObject({ name: "Leica", price: "12.5", currency: "EUR", description: null });
  });

  it("rejects invalid money and initial SOLD status", () => {
    const base = { name: "x", price: "1.00" };
    expect(createProductSchema.safeParse({ ...base, price: "-1" }).success).toBe(false);
    expect(createProductSchema.safeParse({ ...base, price: "1.999" }).success).toBe(false);
    expect(createProductSchema.safeParse({ ...base, status: "SOLD" }).success).toBe(false);
  });

  it("requires at least one field on update and forbids status/unknown fields", () => {
    expect(updateProductSchema.safeParse({}).success).toBe(false);
    expect(updateProductSchema.safeParse({ status: "SOLD" }).success).toBe(false);
    expect(updateProductSchema.safeParse({ name: "New" }).success).toBe(true);
  });
});
