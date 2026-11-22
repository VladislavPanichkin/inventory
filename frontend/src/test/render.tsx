import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { vi } from "vitest";
import { createQueryClient } from "@/lib/query-client";
import type { Admin, Product, ProductImage } from "@/lib/types";
import { routes } from "@/routes";

/** Renders the real route tree at `path` with an isolated, non-retrying query client. */
export function renderRoute(path = "/") {
  const queryClient = createQueryClient({ queries: { retry: false, refetchInterval: false, refetchOnWindowFocus: false } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...utils, router, queryClient };
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const errorResponse = (status: number, code: string, message: string, details?: unknown) =>
  jsonResponse({ error: { code, message, ...(details ? { details } : {}) } }, status);

export interface RecordedCall {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  headers: Record<string, string>;
}

type Handler = (call: RecordedCall) => Response | Promise<Response>;
type RouteTable = Record<string, Handler | object>;

function matches(pattern: string, path: string) {
  const a = pattern.split("/");
  const b = path.split("/");
  return a.length === b.length && a.every((seg, i) => seg.startsWith(":") || seg === b[i]);
}

/**
 * Stubs global fetch with a small route table keyed by "METHOD /path" (paths relative
 * to /api/v1, `:param` segments allowed). Plain objects are returned as 200 JSON.
 */
export function mockApi(table: RouteTable) {
  const calls: RecordedCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), "http://localhost");
    const call: RecordedCall = {
      method: (init.method ?? "GET").toUpperCase(),
      path: url.pathname.replace(/^\/api\/v1/, ""),
      query: url.searchParams,
      // JSON bodies are parsed; multipart uploads are recorded as the FormData object itself.
      body: typeof init.body === "string" ? JSON.parse(init.body) : init.body instanceof FormData ? init.body : undefined,
      headers: (init.headers ?? {}) as Record<string, string>,
    };
    calls.push(call);
    for (const [key, handler] of Object.entries(table)) {
      const [method, pattern] = key.split(" ");
      if (method === call.method && matches(pattern!, call.path)) {
        return typeof handler === "function" ? (handler as Handler)(call) : jsonResponse(handler);
      }
    }
    return errorResponse(404, "NOT_FOUND", `No mock for ${call.method} ${call.path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

// ---------- fixtures ----------

export const admin: Admin = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "admin@example.com",
  role: "ADMIN",
  demo: null,
};

/** The demo account with `changesUsed` of its 5 changes spent. */
export const demoAccount = (changesUsed = 0): Admin => ({
  id: "00000000-0000-4000-8000-000000000002",
  email: "demo@example.com",
  role: "DEMO",
  demo: { changesUsed, changesLimit: 5 },
});

export const authed = {
  "GET /auth/me": { data: admin },
  "GET /health": {
    data: {
      status: "ok",
      version: "0.1.0",
      environment: "test",
      timestamp: "2026-01-01T00:00:00.000Z",
      checks: { database: { status: "up", latencyMs: 2 }, ebayCredentials: { status: "missing" } },
    },
  },
};

export function productFixture(overrides: Partial<Product> = {}): Product {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Leica M3",
    description: "Clean finder",
    price: "1450.00",
    currency: "EUR",
    condition: "Used",
    status: "AVAILABLE",
    createdAt: "2026-01-01T10:00:00.000Z",
    updatedAt: "2026-01-02T10:00:00.000Z",
    listing: null,
    images: [],
    ...overrides,
  };
}

/** A stored photo as the API returns it; `n` makes distinct IDs/positions. */
export function imageFixture(n = 1, overrides: Partial<ProductImage> = {}): ProductImage {
  const id = `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
  return {
    id,
    url: `/api/v1/images/${id}`,
    thumbUrl: `/api/v1/images/${id}/thumb`,
    width: 2048,
    height: 1536,
    sizeBytes: 480_000,
    position: n - 1,
    createdAt: "2026-01-03T10:00:00.000Z",
    ...overrides,
  };
}

export const page = <T,>(data: T[], total = data.length) => ({
  data,
  meta: { page: 1, pageSize: 20, total, totalPages: Math.max(1, Math.ceil(total / 20)) },
});
