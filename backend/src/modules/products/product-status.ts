import { ProductStatus } from "../../generated/prisma/enums.js";

/**
 * Pure business rules for product status changes. No I/O: easy to test and reuse.
 *
 * Automatic transitions (eBay sale detected, cancellation) are added in Phase 5
 * and will live here too, so all status rules stay in one place.
 */

export const PRODUCT_STATUSES = Object.values(ProductStatus) as ProductStatus[];

/** Statuses a product can be created with. SOLD only results from a recorded sale or a manual correction. */
export const INITIAL_STATUSES = [ProductStatus.AVAILABLE, ProductStatus.RESERVED] as const;

export type TransitionCheck =
  | { ok: true }
  | { ok: false; code: "STATUS_UNCHANGED" | "REASON_REQUIRED"; message: string };

/**
 * Manual corrections by the administrator.
 * - Any status may be set manually (the admin knows the physical reality).
 * - Moving a product *away from SOLD* overrides a recorded sale, so a reason is
 *   mandatory and is kept in the status history.
 */
export function checkManualTransition(from: ProductStatus, to: ProductStatus, reason?: string | null): TransitionCheck {
  if (from === to) {
    return { ok: false, code: "STATUS_UNCHANGED", message: `Product is already ${to}` };
  }
  if (from === ProductStatus.SOLD && !reason?.trim()) {
    return {
      ok: false,
      code: "REASON_REQUIRED",
      message: "A reason is required when changing the status of a SOLD product",
    };
  }
  return { ok: true };
}
