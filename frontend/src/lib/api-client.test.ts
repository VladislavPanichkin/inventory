import { describe, expect, it, vi } from "vitest";
import { ApiError, apiRequest, toQueryString } from "@/lib/api-client";
import { jsonResponse } from "@/test/render";

describe("apiRequest", () => {
  it("prefixes /api/v1, sends cookies and returns the JSON body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { ok: true } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest("/things")).resolves.toEqual({ data: { ok: true } });
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/things", expect.objectContaining({ credentials: "include" }));
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)["X-Requested-With"]).toBe("fetch");
  });

  it("handles 204 No Content", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(apiRequest("/products/x", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("builds query strings without empty values", () => {
    expect(toQueryString({ page: 2, search: "", status: undefined, sort: "name" })).toBe("?page=2&sort=name");
    expect(toQueryString({})).toBe("");
  });

  it("serialises JSON bodies", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: {} }, 201));
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("/things", { method: "POST", body: { name: "x" } });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.body).toBe('{"name":"x"}');
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("turns the error envelope into an ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: { code: "NOT_FOUND", message: "Product x not found", requestId: "r1" } }, 404)),
    );

    const error = await apiRequest("/products/x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, code: "NOT_FOUND", message: "Product x not found", requestId: "r1" });
  });

  it("reports network failures with status 0", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const error = (await apiRequest("/health").catch((e: unknown) => e)) as ApiError;
    expect(error.isNetworkError).toBe(true);
    expect(error.code).toBe("NETWORK_ERROR");
  });

  it("returns the body for explicitly accepted error statuses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ data: { status: "degraded" } }, 503)));
    await expect(apiRequest("/health", { acceptStatuses: [503] })).resolves.toEqual({ data: { status: "degraded" } });
  });
});
