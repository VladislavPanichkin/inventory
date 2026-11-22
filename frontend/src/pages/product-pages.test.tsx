import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { authed, errorResponse, imageFixture, jsonResponse, mockApi, productFixture, renderRoute } from "@/test/render";

const product = productFixture();

describe("Add product", () => {
  it("shows validation errors and does not submit invalid data", async () => {
    const { calls } = mockApi({ ...authed });
    renderRoute("/products/new");
    await userEvent.click(await screen.findByRole("button", { name: "Create product" }));

    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    expect(screen.queryByLabelText("SKU")).not.toBeInTheDocument();
    expect(screen.getByText("Enter a price such as 149.90")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("accepts a decimal comma, normalises input and opens the new product", async () => {
    const { calls } = mockApi({
      ...authed,
      "POST /products": { data: product },
      "GET /products/:id": { data: product },
      "GET /products/:id/sales": { data: [] },
      "GET /products/:id/status-history": { data: [] },
    });
    const { router } = renderRoute("/products/new");

    await userEvent.type(await screen.findByLabelText("Name"), "Leica M3");
    await userEvent.type(screen.getByLabelText("Price"), "1450,5");
    await userEvent.click(screen.getByRole("button", { name: "Create product" }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/products/${product.id}`));
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({
      name: "Leica M3",
      description: null,
      price: "1450.5",
      currency: "EUR",
      condition: null,
    });
    // Photos are uploaded on the details page, not typed in as a URL.
    expect(screen.queryByLabelText("Image URL")).not.toBeInTheDocument();
  });

  it("maps server-side validation errors onto the matching field", async () => {
    mockApi({
      ...authed,
      "POST /products": () =>
        errorResponse(400, "VALIDATION_ERROR", "Request validation failed", [
          { path: "condition", message: "Too long for the server" },
        ]),
    });
    renderRoute("/products/new");
    await userEvent.type(await screen.findByLabelText("Name"), "Leica");
    await userEvent.type(screen.getByLabelText("Price"), "10");
    await userEvent.click(screen.getByRole("button", { name: "Create product" }));

    expect(await screen.findByText("Too long for the server")).toBeInTheDocument();
    expect(screen.getByLabelText("Condition")).toHaveAttribute("aria-invalid", "true");
  });
});

describe("Edit product", () => {
  it("prefills the form and sends changes", async () => {
    const { calls } = mockApi({
      ...authed,
      "GET /products/:id": { data: product },
      "PATCH /products/:id": (call) => jsonResponse({ data: { ...product, ...(call.body as object) } }),
      "GET /products/:id/sales": { data: [] },
      "GET /products/:id/status-history": { data: [] },
    });
    renderRoute(`/products/${product.id}/edit`);

    const name = await screen.findByLabelText("Name");
    expect(name).toHaveValue("Leica M3");
    await userEvent.clear(name);
    await userEvent.type(name, "Leica M3 (1957)");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(calls.find((c) => c.method === "PATCH")?.body).toMatchObject({ name: "Leica M3 (1957)" }));
  });
});

describe("Product details", () => {
  const sold = productFixture({ status: "SOLD" });
  const routes = {
    ...authed,
    "GET /products/:id": { data: sold },
    "GET /products/:id/sales": {
      data: [
        {
          id: "s1",
          product: { id: sold.id, name: sold.name },
          ebayOrderId: "12-34567-89012",
          ebayLineItemId: "100200300",
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
    },
    "GET /products/:id/status-history": {
      data: [
        { id: "h2", fromStatus: "AVAILABLE", toStatus: "SOLD", source: "EBAY_ORDER", reason: null, saleId: "s1", createdAt: "2026-01-05T10:00:00.000Z" },
        { id: "h1", fromStatus: null, toStatus: "AVAILABLE", source: "MANUAL", reason: "Product created", saleId: null, createdAt: "2026-01-01T10:00:00.000Z" },
      ],
    },
  };

  it("shows product info, sales history and status history", async () => {
    mockApi(routes);
    renderRoute(`/products/${sold.id}`);

    expect(await screen.findByRole("heading", { name: "Leica M3" })).toBeInTheDocument();
    expect(await screen.findByText("12-34567-89012")).toBeInTheDocument();
    const history = await screen.findByRole("list", { name: "Status history" });
    expect(within(history).getByText("eBay order")).toBeInTheDocument();
    expect(within(history).getByText("Product created")).toBeInTheDocument();
    expect(screen.getByText("Not linked to eBay")).toBeInTheDocument();
    expect(screen.queryByText("Created")).not.toBeInTheDocument();
    expect(screen.queryByText("Last updated")).not.toBeInTheDocument();
  });

  it("requires a reason to change the status of a sold product", async () => {
    const { calls } = mockApi({ ...routes, "PATCH /products/:id/status": { data: { ...sold, status: "AVAILABLE" } } });
    renderRoute(`/products/${sold.id}`);

    await userEvent.click(await screen.findByRole("button", { name: /Change status/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Reason (required)")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "Change status" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("A reason is required");
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);

    await userEvent.type(within(dialog).getByLabelText(/Reason/), "Buyer cancelled before payment");
    await userEvent.click(within(dialog).getByRole("button", { name: "Change status" }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({
        status: "AVAILABLE",
        reason: "Buyer cancelled before payment",
      }),
    );
  });

  it("shows the picture uncropped with its original proportions", async () => {
    const withImage = { ...sold, images: [imageFixture(1)] };
    mockApi({ ...routes, "GET /products/:id": { data: withImage } });
    renderRoute(`/products/${sold.id}`);

    const img = await screen.findByRole("img", { name: "Leica M3" });
    expect(img).toHaveAttribute("src", imageFixture(1).url);
    expect(img).toHaveClass("object-contain", "w-auto", "h-auto", "max-w-full");
    expect(img).not.toHaveClass("object-cover");
  });

  it("asks for confirmation before archiving", async () => {
    const available = productFixture();
    const { calls } = mockApi({
      ...routes,
      "GET /products/:id": { data: available },
      "PATCH /products/:id/status": { data: { ...available, status: "ARCHIVED" } },
    });
    renderRoute(`/products/${available.id}`);
    await userEvent.click(await screen.findByRole("button", { name: /Archive/ }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Archive product?")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);

    await userEvent.click(within(dialog).getByRole("button", { name: "Archive" }));
    await waitFor(() => {
      const patch = calls.find((c) => c.method === "PATCH")!;
      expect(patch.path).toBe(`/products/${available.id}/status`);
      expect(patch.body).toMatchObject({ status: "ARCHIVED" });
    });
  });

  it("shows a not-found error for unknown products", async () => {
    mockApi({ ...authed, "GET /products/:id": () => errorResponse(404, "NOT_FOUND", "Product x not found") });
    renderRoute("/products/00000000-0000-4000-8000-000000000000");
    expect(await screen.findByText("Product x not found")).toBeInTheDocument();
  });
});
