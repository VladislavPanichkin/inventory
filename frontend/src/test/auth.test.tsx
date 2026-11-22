import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { safeRedirectTarget } from "@/components/require-auth";
import { admin, authed, errorResponse, jsonResponse, mockApi, page, renderRoute } from "@/test/render";

const dashboardEmpty = {
  data: {
    products: { total: 0, available: 0, reserved: 0, sold: 0, archived: 0 },
    recentSales: [],
    ebay: { connectionStatus: "NOT_CONNECTED", sellerUsername: null, marketplaceId: null },
    sync: { lastSuccessfulSyncAt: null, lastSyncStatus: null, lastSyncStartedAt: null, failedNotifications: 0, openIssues: 0 },
    warnings: [],
  },
};

describe("authentication flow", () => {
  it("redirects unauthenticated visitors to the login page, keeping the target", async () => {
    mockApi({ "GET /auth/me": () => errorResponse(401, "UNAUTHORIZED", "Authentication required") });
    const { router } = renderRoute("/products?status=SOLD");

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.search).toBe(`?next=${encodeURIComponent("/products?status=SOLD")}`);
  });

  it("validates the form before calling the API", async () => {
    const { calls } = mockApi({ "GET /auth/me": () => errorResponse(401, "UNAUTHORIZED", "x") });
    renderRoute("/login");
    await userEvent.click(await screen.findByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Email is required")).toBeInTheDocument();
    expect(screen.getByText("Password is required")).toBeInTheDocument();
    expect(calls.some((c) => c.path === "/auth/login")).toBe(false);
  });

  it("shows a generic message for invalid credentials", async () => {
    mockApi({
      "GET /auth/me": () => errorResponse(401, "UNAUTHORIZED", "x"),
      "POST /auth/login": () => errorResponse(401, "INVALID_CREDENTIALS", "Invalid email or password"),
    });
    renderRoute("/login");
    await userEvent.type(await screen.findByLabelText("Email"), "admin@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password.");
  });

  it("logs in and continues to the requested page with the CSRF header set", async () => {
    let loggedIn = false;
    const { calls } = mockApi({
      ...authed,
      "GET /auth/me": () => (loggedIn ? jsonResponse({ data: admin }) : errorResponse(401, "UNAUTHORIZED", "x")),
      "POST /auth/login": () => {
        loggedIn = true;
        return jsonResponse({ data: admin });
      },
      "GET /products": page([]),
      "GET /dashboard/summary": dashboardEmpty,
    });
    const { router } = renderRoute("/login?next=%2Fproducts");
    await userEvent.type(await screen.findByLabelText("Email"), "admin@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "correct-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/products"));
    const loginCall = calls.find((c) => c.path === "/auth/login")!;
    expect(loginCall.body).toEqual({ email: "admin@example.com", password: "correct-password" });
    expect(loginCall.headers["X-Requested-With"]).toBe("fetch");
  });

  it("returns to the login page when a request reports the session expired", async () => {
    let expired = false;
    mockApi({
      ...authed,
      "GET /auth/me": () => (expired ? errorResponse(401, "UNAUTHORIZED", "x") : jsonResponse({ data: admin })),
      "GET /dashboard/summary": () => {
        expired = true;
        return errorResponse(401, "UNAUTHORIZED", "Authentication required");
      },
    });
    const { router } = renderRoute("/");
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
  });
});

describe("safeRedirectTarget", () => {
  it("only allows same-app relative paths", () => {
    expect(safeRedirectTarget("/products?x=1")).toBe("/products?x=1");
    expect(safeRedirectTarget(null)).toBe("/");
    expect(safeRedirectTarget("https://evil.example")).toBe("/");
    expect(safeRedirectTarget("//evil.example")).toBe("/");
    expect(safeRedirectTarget("/\\evil.example")).toBe("/");
  });
});
