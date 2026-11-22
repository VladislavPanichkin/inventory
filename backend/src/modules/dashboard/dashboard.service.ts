import { nowFrom, type AppDeps, type UserRole } from "../../common/router.js";
import { ProductStatus } from "../../generated/prisma/enums.js";
import { DEMO_SELLER_USERNAME } from "../demo/demo-data.js";
import { createSalesService } from "../sales/sales.service.js";

/** No successful order sync for this long (while connected) raises a warning. */
export const SYNC_STALE_AFTER_MS = 30 * 60 * 1000;
/** Warn this long before eBay's refresh token (≈18 months) expires and reconnecting is required. */
export const REFRESH_TOKEN_WARNING_MS = 30 * 24 * 60 * 60 * 1000;

export type WarningSeverity = "info" | "warning" | "error";

export interface DashboardWarning {
  code: string;
  severity: WarningSeverity;
  message: string;
}

export interface SyncHealthInput {
  connectionStatus: "NOT_CONNECTED" | "CONNECTED" | "DISCONNECTED" | "REAUTH_REQUIRED";
  lastSuccessfulSyncAt: Date | null;
  failedNotifications: number;
  openIssues: number;
  now: Date;
  refreshTokenExpiresAt?: Date | null;
}

/** Pure function: derives user-facing warnings from synchronization state. */
export function computeWarnings(input: SyncHealthInput): DashboardWarning[] {
  const warnings: DashboardWarning[] = [];

  if (input.connectionStatus === "REAUTH_REQUIRED") {
    warnings.push({
      code: "EBAY_REAUTH_REQUIRED",
      severity: "error",
      message: "eBay authorization expired or was revoked. Reconnect your eBay account so sales keep being detected.",
    });
  } else if (input.connectionStatus !== "CONNECTED") {
    warnings.push({
      code: "EBAY_NOT_CONNECTED",
      severity: "info",
      message: "eBay is not connected. Sales are not being detected automatically.",
    });
  } else if (
    !input.lastSuccessfulSyncAt ||
    input.now.getTime() - input.lastSuccessfulSyncAt.getTime() > SYNC_STALE_AFTER_MS
  ) {
    warnings.push({
      code: "SYNC_STALE",
      severity: "warning",
      message: "No successful eBay synchronization in the last 30 minutes. Data shown may be out of date.",
    });
  }

  if (
    input.connectionStatus === "CONNECTED" &&
    input.refreshTokenExpiresAt &&
    input.refreshTokenExpiresAt.getTime() - input.now.getTime() < REFRESH_TOKEN_WARNING_MS
  ) {
    warnings.push({
      code: "EBAY_AUTH_EXPIRING",
      severity: "warning",
      message: `eBay authorization expires on ${input.refreshTokenExpiresAt.toISOString().slice(0, 10)}. Reconnect eBay before then.`,
    });
  }

  if (input.failedNotifications > 0) {
    warnings.push({
      code: "FAILED_NOTIFICATIONS",
      severity: "warning",
      message: `${input.failedNotifications} eBay notification(s) failed processing and need attention.`,
    });
  }
  if (input.openIssues > 0) {
    warnings.push({
      code: "OPEN_ISSUES",
      severity: "warning",
      message: `${input.openIssues} synchronization issue(s) need manual review.`,
    });
  }
  return warnings;
}

export function createDashboardService(deps: AppDeps) {
  const { db } = deps;
  const sales = createSalesService(deps);

  return {
    /**
     * Counts and recent sales are the signed-in account's own. The eBay connection and
     * synchronization state belong to the administrator: the demo account gets none of it
     * (not even the seller name) and no warnings about it. What the demo account sees
     * instead is the state of its simulated eBay connection.
     */
    async summary(user: { id: string; role: UserRole }) {
      const isAdmin = user.role === "ADMIN";
      const [statusCounts, recentSales, account, lastSuccess, lastSync, failedNotifications, openIssues, demoUser] =
        await Promise.all([
          db.product.groupBy({ by: ["status"], where: { ownerId: user.id }, _count: { _all: true } }),
          sales.recent(user.id, 5),
          isAdmin ? db.ebayAccount.findFirst({ orderBy: { createdAt: "asc" } }) : null,
          isAdmin ? db.syncLog.findFirst({ where: { status: "SUCCESS" }, orderBy: { completedAt: "desc" } }) : null,
          isAdmin ? db.syncLog.findFirst({ orderBy: { startedAt: "desc" } }) : null,
          isAdmin ? db.ebayNotification.count({ where: { processingStatus: "FAILED" } }) : 0,
          isAdmin ? db.reconciliationIssue.count({ where: { resolvedAt: null } }) : 0,
          isAdmin
            ? null
            : db.adminUser.findFirst({ where: { id: user.id, role: "DEMO" }, select: { demoEbayConnectedAt: true } }),
        ]);
      const demoConnected = Boolean(demoUser?.demoEbayConnectedAt);

      const count = (status: ProductStatus) => statusCounts.find((row) => row.status === status)?._count._all ?? 0;
      const products = {
        available: count(ProductStatus.AVAILABLE),
        reserved: count(ProductStatus.RESERVED),
        sold: count(ProductStatus.SOLD),
        archived: count(ProductStatus.ARCHIVED),
        total: 0,
      };
      products.total = products.available + products.reserved + products.sold + products.archived;

      const connectionStatus = demoConnected
        ? ("CONNECTED" as const)
        : (account?.connectionStatus ?? ("NOT_CONNECTED" as const));
      const lastSuccessfulSyncAt = lastSuccess?.completedAt ?? null;

      return {
        products,
        recentSales,
        ebay: {
          connectionStatus,
          sellerUsername: demoConnected ? DEMO_SELLER_USERNAME : (account?.sellerUsername ?? null),
          marketplaceId: demoConnected ? deps.config.EBAY_MARKETPLACE_ID : (account?.marketplaceId ?? null),
        },
        sync: {
          lastSuccessfulSyncAt: lastSuccessfulSyncAt?.toISOString() ?? null,
          lastSyncStatus: lastSync?.status ?? null,
          lastSyncStartedAt: lastSync?.startedAt.toISOString() ?? null,
          failedNotifications,
          openIssues,
        },
        warnings: isAdmin
          ? computeWarnings({
              connectionStatus,
              lastSuccessfulSyncAt,
              failedNotifications,
              openIssues,
              now: nowFrom(deps),
              refreshTokenExpiresAt: account?.refreshTokenExpiresAt ?? null,
            })
          : [],
      };
    },
  };
}
