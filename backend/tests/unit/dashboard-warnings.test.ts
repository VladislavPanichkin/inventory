import { describe, expect, it } from "vitest";
import { computeWarnings, SYNC_STALE_AFTER_MS } from "../../src/modules/dashboard/dashboard.service.js";

const now = new Date("2026-01-01T12:00:00Z");
const base = { lastSuccessfulSyncAt: null, failedNotifications: 0, openIssues: 0, now };
const codes = (input: Parameters<typeof computeWarnings>[0]) => computeWarnings(input).map((w) => w.code);

describe("computeWarnings", () => {
  it("informs when eBay is not connected", () => {
    expect(codes({ ...base, connectionStatus: "NOT_CONNECTED" })).toEqual(["EBAY_NOT_CONNECTED"]);
    expect(codes({ ...base, connectionStatus: "DISCONNECTED" })).toEqual(["EBAY_NOT_CONNECTED"]);
  });

  it("flags revoked authorization as an error", () => {
    const [warning] = computeWarnings({ ...base, connectionStatus: "REAUTH_REQUIRED" });
    expect(warning).toMatchObject({ code: "EBAY_REAUTH_REQUIRED", severity: "error" });
  });

  it("warns when connected but sync is stale or never ran", () => {
    expect(codes({ ...base, connectionStatus: "CONNECTED" })).toEqual(["SYNC_STALE"]);
    const stale = new Date(now.getTime() - SYNC_STALE_AFTER_MS - 1);
    expect(codes({ ...base, connectionStatus: "CONNECTED", lastSuccessfulSyncAt: stale })).toEqual(["SYNC_STALE"]);
  });

  it("is quiet when connected and recently synced", () => {
    const recent = new Date(now.getTime() - 60_000);
    expect(codes({ ...base, connectionStatus: "CONNECTED", lastSuccessfulSyncAt: recent })).toEqual([]);
  });

  it("warns 30 days before the eBay authorization expires", () => {
    const recent = new Date(now.getTime() - 60_000);
    const soon = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);
    const later = new Date(now.getTime() + 200 * 24 * 60 * 60 * 1000);
    const connected = { ...base, connectionStatus: "CONNECTED" as const, lastSuccessfulSyncAt: recent };
    expect(codes({ ...connected, refreshTokenExpiresAt: soon })).toEqual(["EBAY_AUTH_EXPIRING"]);
    expect(codes({ ...connected, refreshTokenExpiresAt: later })).toEqual([]);
  });

  it("reports failed notifications and open issues", () => {
    const recent = new Date(now.getTime() - 60_000);
    expect(
      codes({ ...base, connectionStatus: "CONNECTED", lastSuccessfulSyncAt: recent, failedNotifications: 2, openIssues: 1 }),
    ).toEqual(["FAILED_NOTIFICATIONS", "OPEN_ISSUES"]);
  });
});
