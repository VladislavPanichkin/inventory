import { describe, expect, it } from "vitest";
import { checkManualTransition, PRODUCT_STATUSES } from "../../src/modules/products/product-status.js";
import type { ProductStatus } from "../../src/generated/prisma/enums.js";

describe("checkManualTransition", () => {
  it("rejects a no-op transition", () => {
    for (const status of PRODUCT_STATUSES) {
      expect(checkManualTransition(status, status, "any")).toMatchObject({ ok: false, code: "STATUS_UNCHANGED" });
    }
  });

  it("requires a reason to move a product away from SOLD", () => {
    for (const to of ["AVAILABLE", "RESERVED", "ARCHIVED"] as ProductStatus[]) {
      expect(checkManualTransition("SOLD", to)).toMatchObject({ ok: false, code: "REASON_REQUIRED" });
      expect(checkManualTransition("SOLD", to, "   ")).toMatchObject({ ok: false, code: "REASON_REQUIRED" });
      expect(checkManualTransition("SOLD", to, "Buyer never paid, relisted")).toEqual({ ok: true });
    }
  });

  it("allows every other manual transition without a reason", () => {
    const nonSold = PRODUCT_STATUSES.filter((s) => s !== "SOLD");
    for (const from of nonSold) {
      for (const to of PRODUCT_STATUSES) {
        if (from !== to) expect(checkManualTransition(from, to), `${from} -> ${to}`).toEqual({ ok: true });
      }
    }
  });
});
