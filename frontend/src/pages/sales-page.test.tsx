import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { authed, mockApi, page, renderRoute } from "@/test/render";

const sale = {
  id: "s1",
  product: { id: "p1", name: "Leica M3" },
  ebayOrderId: "12-34567-89012",
  ebayLineItemId: "100200300",
  ebayItemId: "110",
  quantity: 1,
  soldPrice: "1450.00",
  currency: "EUR",
  soldAt: "2026-01-05T10:00:00.000Z",
  saleStatus: "CANCELLED",
  cancelledAt: "2026-01-06T10:00:00.000Z",
  cancellationReason: "Buyer request",
  createdAt: "2026-01-05T10:00:00.000Z",
};

describe("Sales page", () => {
  it("lists sales with order and line item IDs", async () => {
    mockApi({ ...authed, "GET /sales": page([sale]) });
    renderRoute("/sales");

    const row = (await screen.findByRole("link", { name: "Leica M3" })).closest("tr")!;
    expect(within(row).getByText("12-34567-89012")).toBeInTheDocument();
    expect(within(row).getByText("100200300")).toBeInTheDocument();
    expect(within(row).getByText("Cancelled")).toBeInTheDocument();
  });

  it("filters by sale status", async () => {
    const { calls } = mockApi({ ...authed, "GET /sales": page([sale]) });
    renderRoute("/sales");
    await screen.findByRole("link", { name: "Leica M3" });
    await userEvent.selectOptions(screen.getByLabelText("Filter by sale status"), "CONFIRMED");
    await waitFor(() => expect(calls.at(-1)!.query.get("status")).toBe("CONFIRMED"));
  });

  it("shows an empty state", async () => {
    mockApi({ ...authed, "GET /sales": page([]) });
    renderRoute("/sales");
    expect(await screen.findByText("No sales yet")).toBeInTheDocument();
  });
});
