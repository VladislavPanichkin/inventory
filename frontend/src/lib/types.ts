/** API response types. Mirror backend/src/modules/*\/*.schemas.ts (see /api/v1/openapi.json). */

export const PRODUCT_STATUSES = ["AVAILABLE", "RESERVED", "SOLD", "ARCHIVED"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export type ListingStatus = "ACTIVE" | "ENDED" | "UNKNOWN";
export type SaleStatus = "CONFIRMED" | "CANCELLED";

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface EbayListingSummary {
  id: string;
  ebayItemId: string;
  marketplaceId: string;
  title: string | null;
  listingStatus: ListingStatus;
  listingUrl: string | null;
  /** eBay's own picture of the listing. Shown until the product has photos of its own. */
  imageUrl: string | null;
  lastSyncedAt: string | null;
}

export interface Product {
  id: string;
  name: string;
  description: string | null;
  price: string;
  currency: string;
  condition: string | null;
  status: ProductStatus;
  createdAt: string;
  updatedAt: string;
  listing: EbayListingSummary | null;
  /** Uploaded photos, main photo first. */
  images: ProductImage[];
}

export interface ProductImage {
  id: string;
  /** Full-size photo (same-origin URL; requires the session cookie). */
  url: string;
  /** Small version for lists. */
  thumbUrl: string;
  width: number;
  height: number;
  sizeBytes: number;
  position: number;
  createdAt: string;
}

/** Mirrors the backend limit (eBay's per-listing maximum). */
export const MAX_IMAGES_PER_PRODUCT = 24;

export interface StatusChange {
  id: string;
  fromStatus: ProductStatus | null;
  toStatus: ProductStatus;
  source: "MANUAL" | "EBAY_ORDER" | "EBAY_CANCELLATION" | "IMPORT" | "SYSTEM";
  reason: string | null;
  saleId: string | null;
  createdAt: string;
}

export interface Sale {
  id: string;
  product: { id: string; name: string };
  ebayOrderId: string;
  ebayLineItemId: string;
  ebayItemId: string | null;
  quantity: number;
  soldPrice: string;
  currency: string;
  soldAt: string;
  saleStatus: SaleStatus;
  cancelledAt: string | null;
  cancellationReason: string | null;
  createdAt: string;
}

export interface DashboardWarning {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
}

export interface DashboardSummary {
  products: { total: number; available: number; reserved: number; sold: number; archived: number };
  recentSales: Sale[];
  ebay: {
    connectionStatus: "NOT_CONNECTED" | "CONNECTED" | "DISCONNECTED" | "REAUTH_REQUIRED";
    sellerUsername: string | null;
    marketplaceId: string | null;
  };
  sync: {
    lastSuccessfulSyncAt: string | null;
    lastSyncStatus: "RUNNING" | "SUCCESS" | "FAILED" | "PARTIAL" | null;
    lastSyncStartedAt: string | null;
    failedNotifications: number;
    openIssues: number;
  };
  warnings: DashboardWarning[];
}

/** The signed-in account. DEMO is the restricted showcase account. */
export interface Admin {
  id: string;
  email: string;
  role: "ADMIN" | "DEMO";
  /** The demo account's change allowance; null for the administrator. */
  demo: { changesUsed: number; changesLimit: number } | null;
}

export type EbayConnectionStatus = "NOT_CONNECTED" | "CONNECTED" | "DISCONNECTED" | "REAUTH_REQUIRED";

export interface EbayConnection {
  configured: boolean;
  environment: "sandbox" | "production";
  connectionStatus: EbayConnectionStatus;
  sellerUsername: string | null;
  marketplaceId: string;
  connectedAt: string | null;
  refreshTokenExpiresAt: string | null;
  scopes: string[];
  lastErrorMessage: string | null;
  /** Demo account only: credits for the sample listing photos of the simulated eBay. */
  photoCredits?: string[];
}

/** An active listing as read live from eBay. */
export interface EbayActiveListing {
  itemId: string;
  title: string | null;
  price: string | null;
  currency: string | null;
  listingUrl: string | null;
  imageUrl: string | null;
  quantityAvailable: number | null;
  listingType: string | null;
  /** The inventory product this listing already belongs to, if any. */
  productId: string | null;
}

export type EbayImportSkipReason = "ALREADY_IMPORTED" | "NO_PRICE" | "NOT_ACTIVE";

export interface EbayImportResult {
  created: { itemId: string; productId: string }[];
  skipped: { itemId: string; reason: EbayImportSkipReason }[];
}
