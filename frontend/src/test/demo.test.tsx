import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { EbayActiveListing } from "@/lib/types";
import { authed, demoAccount, errorResponse, jsonResponse, mockApi, page, productFixture, renderRoute } from "@/test/render";

const asDemo = (changesUsed = 0) => ({ ...authed, "GET /auth/me": { data: demoAccount(changesUsed) } });

const dashboard = {
  data: {
    products: { total: 10, available: 6, reserved: 1, sold: 2, archived: 1 },
    recentSales: [],
    ebay: { connectionStatus: "NOT_CONNECTED", sellerUsername: null, marketplaceId: null },
    sync: { lastSuccessfulSyncAt: null, lastSyncStatus: null, lastSyncStartedAt: null, failedNotifications: 0, openIssues: 0 },
    warnings: [],
  },
};

/** The simulated eBay connection as the demo routes report it. */
const sampleConnection = (connected = false) => ({
  data: {
    configured: true,
    environment: "sandbox",
    connectionStatus: connected ? "CONNECTED" : "NOT_CONNECTED",
    sellerUsername: connected ? "sample_seller" : null,
    marketplaceId: "EBAY_DE",
    connectedAt: connected ? "2026-11-22T10:00:00.000Z" : null,
    refreshTokenExpiresAt: connected ? "2028-05-22T10:00:00.000Z" : null,
    scopes: [],
    lastErrorMessage: null,
    photoCredits: ["Leica M3: Sebastian Stabinger, CC BY 3.0, via Wikimedia Commons"],
  },
});

const sampleListing = (overrides: Partial<EbayActiveListing>): EbayActiveListing => ({
  itemId: "DEMO-2001",
  title: "Canon AE-1 with FD 50mm f/1.8",
  price: "189.00",
  currency: "EUR",
  listingUrl: null,
  imageUrl: "/api/v1/demo/ebay/pictures/canon-ae1/s-l140.jpg",
  quantityAvailable: 1,
  listingType: "FixedPriceItem",
  productId: null,
  ...overrides,
});

const sampleListings = [
  sampleListing({ itemId: "DEMO-1001", title: "Leica M3", productId: "11111111-1111-4111-8111-111111111111" }),
  sampleListing({}),
];

describe("demo account", () => {
  it("shows a banner with the changes that are left", async () => {
    mockApi({ ...asDemo(2), "GET /products": page([]) });
    renderRoute("/products");

    const banner = await screen.findByText(/Demo account\./);
    expect(banner.closest("[role=status]")).toHaveTextContent("Sample data, restored at every sign-in. 3 of 5 changes left.");
  });

  it("says how to start over once the changes are used up", async () => {
    mockApi({ ...asDemo(5), "GET /products": page([]) });
    renderRoute("/products");

    expect(await screen.findByText("No changes left. Sign out and in again to start over.")).toBeInTheDocument();
  });

  it("shows no banner to the administrator", async () => {
    mockApi({ ...authed, "GET /products": page([]) });
    renderRoute("/products");

    await screen.findByRole("heading", { name: "Products" });
    expect(screen.queryByText(/Demo account\./)).not.toBeInTheDocument();
  });

  it("shows the simulated eBay, not connected, and never calls the real eBay routes", async () => {
    const { calls } = mockApi({ ...asDemo(), "GET /demo/ebay": sampleConnection() });
    renderRoute("/settings/ebay");

    expect(await screen.findByText("Simulated eBay")).toBeInTheDocument();
    // The badge and status appear once the (simulated) connection has loaded.
    expect(await screen.findByText("Simulated")).toBeInTheDocument();
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    // A button that opens the simulated sign-in, not a link to the real eBay redirect.
    expect(screen.getByRole("button", { name: /Connect eBay account/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Connect eBay account/ })).not.toBeInTheDocument();
    expect(calls.some((call) => call.path.startsWith("/integrations/ebay"))).toBe(false);
  });

  it("connects the sample account through a simulated sign-in and shows its listings", async () => {
    let connected = false;
    const { calls } = mockApi({
      ...asDemo(),
      "GET /demo/ebay": () => jsonResponse(sampleConnection(connected)),
      "POST /demo/ebay/connect": () => {
        connected = true;
        return jsonResponse(sampleConnection(true));
      },
      "GET /demo/ebay/listings": { data: sampleListings },
    });
    renderRoute("/settings/ebay");

    await userEvent.click(await screen.findByRole("button", { name: /Connect eBay account/ }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/a sample seller account is connected instead/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Connect sample account" }));

    expect(await screen.findByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("sample_seller")).toBeInTheDocument();
    const list = await screen.findByRole("list", { name: "eBay listings" });
    expect(within(list).getByText("Canon AE-1 with FD 50mm f/1.8")).toBeInTheDocument();
    expect(within(list).getByRole("link", { name: /“Leica M3” is in the inventory/ })).toBeInTheDocument();
    expect(screen.getByText("Photo credits for the sample listings")).toBeInTheDocument();
    expect(screen.getByText("Leica M3: Sebastian Stabinger, CC BY 3.0, via Wikimedia Commons")).toBeInTheDocument();
    expect(calls.some((call) => call.path.startsWith("/integrations/ebay"))).toBe(false);
  });

  it("adds a sample listing through the simulated eBay routes", async () => {
    const { calls } = mockApi({
      ...asDemo(),
      "GET /demo/ebay": sampleConnection(true),
      "GET /demo/ebay/listings": { data: sampleListings },
      "POST /demo/ebay/listings/import": {
        data: { created: [{ itemId: "DEMO-2001", productId: "p-new" }], skipped: [] },
      },
    });
    renderRoute("/settings/ebay");

    await userEvent.click(await screen.findByRole("button", { name: /Add “Canon AE-1 with FD 50mm f\/1.8” to inventory/ }));

    await waitFor(() =>
      expect(calls.find((call) => call.method === "POST" && call.path === "/demo/ebay/listings/import")?.body).toEqual({
        itemIds: ["DEMO-2001"],
      }),
    );
    expect(calls.some((call) => call.path.startsWith("/integrations/ebay"))).toBe(false);
  });

  it("shows the simulated connection on the dashboard", async () => {
    mockApi({
      ...asDemo(),
      "GET /dashboard/summary": {
        data: { ...dashboard.data, ebay: { connectionStatus: "CONNECTED", sellerUsername: "sample_seller", marketplaceId: "EBAY_DE" } },
      },
    });
    renderRoute("/");

    expect(await screen.findByText("sample_seller")).toBeInTheDocument();
    expect(screen.getByText("(simulated)")).toBeInTheDocument();
  });

  it("updates the banner after a change", async () => {
    const product = productFixture();
    let used = 0;
    mockApi({
      ...authed,
      "GET /auth/me": () => jsonResponse({ data: demoAccount(used) }),
      "GET /products/:id": { data: product },
      "PATCH /products/:id": (call) => {
        used += 1;
        return jsonResponse({ data: { ...product, ...(call.body as object) } });
      },
      "GET /products/:id/sales": { data: [] },
      "GET /products/:id/status-history": { data: [] },
    });
    renderRoute(`/products/${product.id}/edit`);

    expect(await screen.findByText("5 of 5 changes left.")).toBeInTheDocument();
    const name = await screen.findByLabelText("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "Renamed");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("4 of 5 changes left.")).toBeInTheDocument();
  });

  it("shows the server's explanation when the limit is reached", async () => {
    const product = productFixture();
    const message = "The demo account allows 5 changes. Sign out and in again to start over with fresh sample data.";
    const { calls } = mockApi({
      ...asDemo(5),
      "GET /products/:id": { data: product },
      "PATCH /products/:id": () => errorResponse(403, "DEMO_LIMIT_REACHED", message),
      "GET /products/:id/sales": { data: [] },
      "GET /products/:id/status-history": { data: [] },
    });
    renderRoute(`/products/${product.id}/edit`);

    const name = await screen.findByLabelText("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "Renamed");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(calls.some((call) => call.method === "PATCH")).toBe(true));
    expect(await screen.findByText(message)).toBeInTheDocument();
  });
});
