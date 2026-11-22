import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { authed, mockApi, page, productFixture, renderRoute } from "@/test/render";

describe("refresh policy", () => {
  it("loads data once and does not poll", async () => {
    const { calls } = mockApi({ ...authed, "GET /products": page([productFixture()]) });
    renderRoute("/products");
    await screen.findByRole("link", { name: /Leica M3/ });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls.filter((c) => c.path === "/products")).toHaveLength(1);
  });

  it("reloads on-screen data when the refresh button is pressed", async () => {
    const { calls } = mockApi({ ...authed, "GET /products": page([productFixture()]) });
    renderRoute("/products");
    await screen.findByRole("link", { name: /Leica M3/ });

    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(calls.filter((c) => c.path === "/products")).toHaveLength(2));
    // The session check is not repeated by a refresh.
    expect(calls.filter((c) => c.path === "/auth/me")).toHaveLength(1);
  });
});
