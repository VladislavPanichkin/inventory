import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { EbayActiveListing, EbayConnection } from "@/lib/types";
import { authed, errorResponse, jsonResponse, mockApi, renderRoute } from "@/test/render";

const base: EbayConnection = {
  configured: true,
  environment: "sandbox",
  connectionStatus: "NOT_CONNECTED",
  sellerUsername: null,
  marketplaceId: "EBAY_DE",
  connectedAt: null,
  refreshTokenExpiresAt: null,
  scopes: [],
  lastErrorMessage: null,
};

const status = (overrides: Partial<EbayConnection> = {}) => ({ data: { ...base, ...overrides } });

describe("eBay settings page", () => {
  it("offers to connect via a full-page navigation to the backend", async () => {
    mockApi({ ...authed, "GET /integrations/ebay": status() });
    renderRoute("/settings/ebay");

    const connect = await screen.findByRole("link", { name: /Connect eBay account/ });
    expect(connect).toHaveAttribute("href", "/api/v1/integrations/ebay/connect");
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(screen.getByText("Sandbox")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Disconnect/ })).not.toBeInTheDocument();
  });

  it("explains missing server credentials and disables connecting", async () => {
    mockApi({ ...authed, "GET /integrations/ebay": status({ configured: false }) });
    renderRoute("/settings/ebay");

    expect(await screen.findByText("eBay credentials not configured")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Connect eBay account/ })).toBeDisabled();
  });

  it("shows a connected account and disconnects after confirmation", async () => {
    const { calls } = mockApi({
      ...authed,
      "GET /integrations/ebay": status({
        connectionStatus: "CONNECTED",
        connectedAt: "2026-03-01T10:00:00.000Z",
        refreshTokenExpiresAt: "2027-09-01T10:00:00.000Z",
      }),
      "POST /integrations/ebay/disconnect": status({ connectionStatus: "DISCONNECTED" }),
      "GET /integrations/ebay/listings": { data: [] },
    });
    renderRoute("/settings/ebay");

    expect(await screen.findByText("Connected")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Reconnect/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Disconnect/ }));
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Disconnect" }));

    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/integrations/ebay/disconnect")).toBe(true));
    expect(await screen.findByText("Disconnected")).toBeInTheDocument();
  });

  it("asks to reconnect when authorization was revoked", async () => {
    mockApi({
      ...authed,
      "GET /integrations/ebay": status({
        connectionStatus: "REAUTH_REQUIRED",
        lastErrorMessage: "eBay authorization was revoked or has expired. Reconnect eBay.",
      }),
    });
    renderRoute("/settings/ebay");

    expect(await screen.findByText("Reconnect required")).toBeInTheDocument();
    expect(screen.getByText("eBay authorization was revoked or has expired. Reconnect eBay.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Reconnect eBay/ })).toBeInTheDocument();
  });

  it("shows the outcome of a failed eBay round trip and cleans the URL", async () => {
    mockApi({ ...authed, "GET /integrations/ebay": status() });
    const { router } = renderRoute("/settings/ebay?error=declined");

    expect(await screen.findByText("eBay connection failed")).toBeInTheDocument();
    expect(screen.getByText(/eBay access was not granted/)).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.search).toBe(""));
  });
});

const connectedStatus = status({ connectionStatus: "CONNECTED", environment: "production" });

const listing = (n: number, overrides: Partial<EbayActiveListing> = {}): EbayActiveListing => ({
  itemId: `12500000000${n}`,
  title: `Listing ${n}`,
  price: "49.90",
  currency: "EUR",
  listingUrl: `https://www.ebay.de/itm/12500000000${n}`,
  imageUrl: `https://i.ebayimg.com/images/g/${n}/s-l140.jpg`,
  quantityAvailable: 1,
  listingType: "FixedPriceItem",
  productId: null,
  ...overrides,
});

describe("eBay listings on the settings page", () => {
  it("does not ask eBay for listings while no account is connected", async () => {
    const { calls } = mockApi({ ...authed, "GET /integrations/ebay": status() });
    renderRoute("/settings/ebay");

    await screen.findByRole("link", { name: /Connect eBay account/ });
    expect(screen.queryByText("Your eBay listings")).not.toBeInTheDocument();
    expect(calls.some((c) => c.path === "/integrations/ebay/listings")).toBe(false);
  });

  it("lists active listings and marks the ones already in the inventory", async () => {
    mockApi({
      ...authed,
      "GET /integrations/ebay": connectedStatus,
      "GET /integrations/ebay/listings": {
        data: [
          listing(1, { title: "Vintage lamp" }),
          listing(2, { title: "Oak chair", productId: "22222222-2222-4222-8222-222222222222" }),
          listing(3, { title: "Odd lot", price: null, quantityAvailable: 3 }),
        ],
      },
    });
    renderRoute("/settings/ebay");

    const list = await screen.findByRole("list", { name: "eBay listings" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("3 active listings, 1 not in the inventory yet")).toBeInTheDocument();

    expect(within(list).getByRole("link", { name: "Open “Vintage lamp” on eBay" })).toHaveAttribute(
      "href",
      "https://www.ebay.de/itm/125000000001",
    );
    expect(within(list).getByRole("link", { name: /“Oak chair” is in the inventory/ })).toHaveAttribute(
      "href",
      "/products/22222222-2222-4222-8222-222222222222",
    );
    // A listing without a price can't become a product.
    expect(within(list).getByRole("button", { name: "Add “Odd lot” to inventory" })).toBeDisabled();
    expect(within(list).getByText("3 available")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add all 1 to inventory" })).toBeInTheDocument();
  });

  it("adds a single listing and reloads the list", async () => {
    let imported = false;
    const { calls } = mockApi({
      ...authed,
      "GET /integrations/ebay": connectedStatus,
      "GET /integrations/ebay/listings": () =>
        jsonResponse({ data: [listing(1, { title: "Vintage lamp", productId: imported ? "p-1" : null }), listing(2)] }),
      "POST /integrations/ebay/listings/import": () => {
        imported = true;
        return jsonResponse({ data: { created: [{ itemId: "125000000001", productId: "p-1" }], skipped: [] } });
      },
    });
    renderRoute("/settings/ebay");

    await userEvent.click(await screen.findByRole("button", { name: "Add “Vintage lamp” to inventory" }));

    expect(await screen.findByRole("link", { name: /“Vintage lamp” is in the inventory/ })).toBeInTheDocument();
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ itemIds: ["125000000001"] });
    expect(screen.getByText("2 active listings, 1 not in the inventory yet")).toBeInTheDocument();
  });

  it("adds all missing listings in one go", async () => {
    const { calls } = mockApi({
      ...authed,
      "GET /integrations/ebay": connectedStatus,
      "GET /integrations/ebay/listings": { data: [listing(1), listing(2)] },
      "POST /integrations/ebay/listings/import": {
        data: {
          created: [
            { itemId: "125000000001", productId: "p-1" },
            { itemId: "125000000002", productId: "p-2" },
          ],
          skipped: [],
        },
      },
    });
    renderRoute("/settings/ebay");

    await userEvent.click(await screen.findByRole("button", { name: "Add all 2 to inventory" }));

    // No item IDs: the server imports everything that is missing.
    await waitFor(() => expect(calls.find((c) => c.method === "POST")?.body).toEqual({}));
    // The list is read from eBay again afterwards.
    await waitFor(() => expect(calls.filter((c) => c.path === "/integrations/ebay/listings")).toHaveLength(2));
  });

  it("shows eBay's reason when the listings can't be read", async () => {
    mockApi({
      ...authed,
      "GET /integrations/ebay": connectedStatus,
      "GET /integrations/ebay/listings": () =>
        errorResponse(502, "EBAY_REJECTED", "eBay rejected the request (error 21919456): Insufficient permissions."),
    });
    renderRoute("/settings/ebay");

    expect(await screen.findByText("Could not load eBay listings")).toBeInTheDocument();
    expect(screen.getByText("eBay rejected the request (error 21919456): Insufficient permissions.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("says so when the account has no active listings", async () => {
    mockApi({ ...authed, "GET /integrations/ebay": connectedStatus, "GET /integrations/ebay/listings": { data: [] } });
    renderRoute("/settings/ebay");
    expect(await screen.findByText("No active listings")).toBeInTheDocument();
  });
});
