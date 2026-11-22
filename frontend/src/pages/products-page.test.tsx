import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { authed, imageFixture, mockApi, page, productFixture, renderRoute } from "@/test/render";

const products = [
  // Two photos: the card must show the first (main) one's thumbnail.
  productFixture({ images: [imageFixture(1), imageFixture(2)] }),
  productFixture({
    id: "22222222-2222-4222-8222-222222222222",
    name: "Omega Seamaster",
    price: "3200.00",
    status: "SOLD",
    listing: {
      id: "l1",
      ebayItemId: "110012345678",
      marketplaceId: "EBAY_DE",
      title: "Omega",
      listingStatus: "ENDED",
      listingUrl: "https://www.ebay.de/itm/110012345678",
      imageUrl: null,
      lastSyncedAt: null,
    },
  }),
];

const card = (name: RegExp) => screen.findByRole("link", { name });

describe("Products page", () => {
  it("shows a card per product with image, name, price and status only", async () => {
    mockApi({ ...authed, "GET /products": page(products) });
    renderRoute("/products");

    const leica = await card(/Leica M3/);
    expect(within(leica).getByRole("heading", { name: "Leica M3" })).toBeInTheDocument();
    expect(within(leica).getByText(/1,450\.00|1\.450,00/)).toBeInTheDocument();
    expect(within(leica).getByText("Available")).toBeInTheDocument();
    expect(leica.querySelector("img")).toHaveAttribute("src", imageFixture(1).thumbUrl);

    const omega = await card(/Omega Seamaster/);
    expect(within(omega).getByText("Sold")).toBeInTheDocument();
    expect(omega.querySelector("img")).toBeNull(); // no photos: placeholder instead
    // No eBay listing, SKU, table or per-item actions on the list.
    expect(screen.queryByText("110012345678")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Archive|Edit|Change status/ })).not.toBeInTheDocument();
  });

  it("opens the details page when a card is clicked", async () => {
    mockApi({
      ...authed,
      "GET /products": page(products),
      "GET /products/:id": { data: products[0] },
      "GET /products/:id/sales": { data: [] },
      "GET /products/:id/status-history": { data: [] },
    });
    const { router } = renderRoute("/products");

    await userEvent.click(await card(/Leica M3/));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/products/${products[0]!.id}`));
  });

  it("sends search (debounced), status filter and sort to the API", async () => {
    const { calls } = mockApi({ ...authed, "GET /products": page(products) });
    renderRoute("/products");
    await card(/Leica M3/);

    await userEvent.type(screen.getByLabelText("Search products"), "leica");
    await waitFor(() => expect(calls.some((c) => c.path === "/products" && c.query.get("search") === "leica")).toBe(true));

    await userEvent.selectOptions(screen.getByLabelText("Filter by status"), "SOLD");
    await waitFor(() => expect(calls.at(-1)!.query.get("status")).toBe("SOLD"));

    await userEvent.selectOptions(screen.getByLabelText("Sort products"), "Price: low to high");
    await waitFor(() => {
      const last = calls.at(-1)!;
      expect(last.query.get("sort")).toBe("price");
      expect(last.query.get("order")).toBe("asc");
      expect(last.query.get("search")).toBe("leica");
      expect(last.query.get("pageSize")).toBe("24");
    });
  });

  it("restores sorting from the URL", async () => {
    mockApi({ ...authed, "GET /products": page(products) });
    renderRoute("/products?sort=name&order=desc");
    await card(/Leica M3/);
    expect(screen.getByLabelText("Sort products")).toHaveValue("name:desc");
  });

  it("shows an empty state with a call to action", async () => {
    mockApi({ ...authed, "GET /products": page([]) });
    renderRoute("/products");
    expect(await screen.findByText("No products yet")).toBeInTheDocument();
  });
});
