-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'SOLD', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "StatusChangeSource" AS ENUM ('MANUAL', 'EBAY_ORDER', 'EBAY_CANCELLATION', 'IMPORT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('ACTIVE', 'ENDED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED', 'PARTIAL');

-- CreateEnum
CREATE TYPE "EbayConnectionStatus" AS ENUM ('CONNECTED', 'DISCONNECTED', 'REAUTH_REQUIRED');

-- CreateEnum
CREATE TYPE "ReconciliationIssueType" AS ENUM ('UNMATCHED_LINE_ITEM', 'SALE_CANCELLED', 'STATUS_CONFLICT', 'DUPLICATE_SALE_FOR_PRODUCT');

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "condition" TEXT,
    "imageUrl" TEXT,
    "status" "ProductStatus" NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_status_changes" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "fromStatus" "ProductStatus",
    "toStatus" "ProductStatus" NOT NULL,
    "source" "StatusChangeSource" NOT NULL,
    "reason" TEXT,
    "saleId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_status_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ebay_listings" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "ebayItemId" TEXT NOT NULL,
    "ebaySku" TEXT,
    "marketplaceId" TEXT NOT NULL,
    "title" TEXT,
    "listingStatus" "ListingStatus" NOT NULL DEFAULT 'UNKNOWN',
    "listingUrl" TEXT,
    "lastSyncedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ebay_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ebay_accounts" (
    "id" UUID NOT NULL,
    "sellerUsername" TEXT,
    "marketplaceId" TEXT NOT NULL,
    "connectionStatus" "EbayConnectionStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "refreshTokenEncrypted" TEXT,
    "refreshTokenExpiresAt" TIMESTAMPTZ(3),
    "accessTokenEncrypted" TEXT,
    "accessTokenExpiresAt" TIMESTAMPTZ(3),
    "scopes" TEXT,
    "lastErrorMessage" TEXT,
    "connectedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ebay_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_states" (
    "id" UUID NOT NULL,
    "state" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "ebayOrderId" TEXT NOT NULL,
    "ebayLineItemId" TEXT NOT NULL,
    "ebayItemId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "soldPrice" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "soldAt" TIMESTAMPTZ(3) NOT NULL,
    "saleStatus" "SaleStatus" NOT NULL DEFAULT 'CONFIRMED',
    "ebayLastModifiedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ebay_notifications" (
    "id" UUID NOT NULL,
    "notificationId" TEXT,
    "topic" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(3),
    "processingStatus" "NotificationProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(3),
    "lockedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ebay_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_logs" (
    "id" UUID NOT NULL,
    "syncType" TEXT NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),
    "recordsProcessed" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "metadata" JSONB,

    CONSTRAINT "sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_checkpoints" (
    "name" TEXT NOT NULL,
    "cursor" TIMESTAMPTZ(3),
    "metadata" JSONB,
    "lockedUntil" TIMESTAMPTZ(3),
    "lockOwner" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sync_checkpoints_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "reconciliation_issues" (
    "id" UUID NOT NULL,
    "type" "ReconciliationIssueType" NOT NULL,
    "productId" UUID,
    "ebayOrderId" TEXT,
    "ebayLineItemId" TEXT,
    "ebayItemId" TEXT,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "resolvedAt" TIMESTAMPTZ(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reconciliation_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_sessions" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "adminUserId" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- CreateIndex
CREATE INDEX "products_status_idx" ON "products"("status");

-- CreateIndex
CREATE INDEX "products_createdAt_idx" ON "products"("createdAt");

-- CreateIndex
CREATE INDEX "products_name_idx" ON "products"("name");

-- CreateIndex
CREATE INDEX "product_status_changes_productId_createdAt_idx" ON "product_status_changes"("productId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ebay_listings_productId_key" ON "ebay_listings"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ebay_listings_ebayItemId_key" ON "ebay_listings"("ebayItemId");

-- CreateIndex
CREATE INDEX "ebay_listings_ebaySku_idx" ON "ebay_listings"("ebaySku");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_states_state_key" ON "oauth_states"("state");

-- CreateIndex
CREATE INDEX "oauth_states_expiresAt_idx" ON "oauth_states"("expiresAt");

-- CreateIndex
CREATE INDEX "sales_productId_idx" ON "sales"("productId");

-- CreateIndex
CREATE INDEX "sales_soldAt_idx" ON "sales"("soldAt");

-- CreateIndex
CREATE INDEX "sales_saleStatus_idx" ON "sales"("saleStatus");

-- CreateIndex
CREATE UNIQUE INDEX "sales_ebayOrderId_ebayLineItemId_key" ON "sales"("ebayOrderId", "ebayLineItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ebay_notifications_notificationId_key" ON "ebay_notifications"("notificationId");

-- CreateIndex
CREATE INDEX "ebay_notifications_processingStatus_nextAttemptAt_idx" ON "ebay_notifications"("processingStatus", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "ebay_notifications_receivedAt_idx" ON "ebay_notifications"("receivedAt");

-- CreateIndex
CREATE INDEX "sync_logs_syncType_startedAt_idx" ON "sync_logs"("syncType", "startedAt");

-- CreateIndex
CREATE INDEX "sync_logs_status_startedAt_idx" ON "sync_logs"("status", "startedAt");

-- CreateIndex
CREATE INDEX "reconciliation_issues_resolvedAt_createdAt_idx" ON "reconciliation_issues"("resolvedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_issues_type_ebayOrderId_ebayLineItemId_key" ON "reconciliation_issues"("type", "ebayOrderId", "ebayLineItemId");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "admin_sessions_tokenHash_key" ON "admin_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "admin_sessions_adminUserId_idx" ON "admin_sessions"("adminUserId");

-- CreateIndex
CREATE INDEX "admin_sessions_expiresAt_idx" ON "admin_sessions"("expiresAt");

-- AddForeignKey
ALTER TABLE "product_status_changes" ADD CONSTRAINT "product_status_changes_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_status_changes" ADD CONSTRAINT "product_status_changes_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebay_listings" ADD CONSTRAINT "ebay_listings_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_issues" ADD CONSTRAINT "reconciliation_issues_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
