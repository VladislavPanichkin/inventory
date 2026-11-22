import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { authed, errorResponse, mockApi, renderRoute } from "@/test/render";

const summary = {
  data: {
    products: { total: 12, available: 7, reserved: 1, sold: 3, archived: 1 },
    recentSales: [
      {
        id: "s1",
        product: { id: "p1", name: "Leica M3" },
        ebayOrderId: "12-34567-89012",
        ebayLineItemId: "1",
        ebayItemId: "110",
        quantity: 1,
        soldPrice: "1450.00",
        currency: "EUR",
        soldAt: "2026-01-05T10:00:00.000Z",
        saleStatus: "CONFIRMED",
        cancelledAt: null,
        cancellationReason: null,
        createdAt: "2026-01-05T10:00:00.000Z",
      },
    ],
    ebay: { connectionStatus: "REAUTH_REQUIRED", sellerUsername: "vintage-seller", marketplaceId: "EBAY_DE" },
    sync: { lastSuccessfulSyncAt: null, lastSyncStatus: "FAILED", lastSyncStartedAt: null, failedNotifications: 2, openIssues: 0 },
    warnings: [
      { code: "EBAY_REAUTH_REQUIRED", severity: "error", message: "eBay authorization expired or was revoked." },
      { code: "FAILED_NOTIFICATIONS", severity: "warning", message: "2 eBay notification(s) failed processing." },
    ],
  },
};

describe("Dashboard", () => {
  it("shows statistics, warnings, recent sales and connection status", async () => {
    mockApi({ ...authed, "GET /dashboard/summary": summary });
    renderRoute("/");

    await screen.findByLabelText("Synchronization warnings"); // summary loaded
    const total = screen.getByText("Total products");
    expect(within(total.parentElement!).getByText("12")).toBeInTheDocument();
    expect(within(screen.getByText("Sold").parentElement!).getByText("3")).toBeInTheDocument();

    const warnings = screen.getByLabelText("Synchronization warnings");
    expect(within(warnings).getByText("eBay authorization expired or was revoked.")).toBeInTheDocument();
    expect(within(warnings).getByText("Action required")).toBeInTheDocument();

    expect(screen.getByRole("link", { name: "Leica M3" })).toHaveAttribute("href", "/products/p1");
    expect(screen.getByText("Reconnect required")).toBeInTheDocument();
    expect(screen.getByText("vintage-seller")).toBeInTheDocument();
    expect(screen.getByText("never")).toBeInTheDocument();
  });

  it("links statistics to the filtered product list", async () => {
    mockApi({ ...authed, "GET /dashboard/summary": summary });
    renderRoute("/");
    const available = await screen.findByText("Available");
    expect(available.closest("a")).toHaveAttribute("href", "/products?status=AVAILABLE");
  });

  it("shows an error with retry when the summary fails", async () => {
    mockApi({ ...authed, "GET /dashboard/summary": () => errorResponse(500, "INTERNAL_ERROR", "An unexpected error occurred") });
    renderRoute("/");
    expect(await screen.findByText("Could not load dashboard")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
