import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/env.js";
import {
  EbayAuthorizationError,
  EbayNotConfiguredError,
  EbayRequestError,
  EbayUnavailableError,
} from "../../src/modules/ebay/ebay-errors.js";
import { createEbayOAuthClient } from "../../src/modules/ebay/ebay-oauth.client.js";
import { createFakeEbay, invalidGrant, refreshResponse, serverError, TEST_EBAY_ENV, tokenResponse } from "../support/fake-ebay.js";

const now = new Date("2026-01-01T00:00:00Z");

function setup(env: Record<string, string> = {}) {
  const ebay = createFakeEbay();
  const config = loadConfig({ DATABASE_URL: "unused", ...TEST_EBAY_ENV, ...env });
  const client = createEbayOAuthClient({ config, fetch: ebay.fetch, now: () => now, sleep: async () => {} });
  return { ebay, client };
}

describe("authorizationUrl", () => {
  it("targets the sandbox consent page with RuName, scopes and state", () => {
    const url = new URL(setup().client.authorizationUrl("state-123"));
    expect(url.origin + url.pathname).toBe("https://auth.sandbox.ebay.com/oauth2/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "test-client-id",
      redirect_uri: "Test_Seller-TestApp-SBX-abcdef",
      response_type: "code",
      scope: "https://api.ebay.com/oauth/api_scope https://api.ebay.com/oauth/api_scope/sell.fulfillment",
      state: "state-123",
      prompt: "login",
    });
  });

  it("uses production endpoints when configured", () => {
    const url = setup({ EBAY_ENVIRONMENT: "production" }).client.authorizationUrl("s");
    expect(url.startsWith("https://auth.ebay.com/oauth2/authorize?")).toBe(true);
  });

  it("refuses to build a URL without credentials", () => {
    const config = loadConfig({ DATABASE_URL: "unused" });
    expect(() => createEbayOAuthClient({ config }).authorizationUrl("s")).toThrow(EbayNotConfiguredError);
  });
});

describe("exchangeCode", () => {
  it("POSTs a form-encoded authorization_code grant with Basic auth and parses tokens", async () => {
    const { ebay, client } = setup();
    ebay.respond(tokenResponse());

    // eBay codes contain characters like '#', '^' and '=' that must be form-encoded.
    const tokens = await client.exchangeCode("v^1.1#i^1#f^0#I^3#r^1#t^Ul4x=");

    const [request] = ebay.requests;
    expect(request!.url).toBe("https://api.sandbox.ebay.com/identity/v1/oauth2/token");
    expect(request!.method).toBe("POST");
    expect(request!.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(request!.headers.Authorization).toBe(`Basic ${btoa("test-client-id:test-client-secret")}`);
    expect(Object.fromEntries(request!.form)).toEqual({
      grant_type: "authorization_code",
      code: "v^1.1#i^1#f^0#I^3#r^1#t^Ul4x=",
      redirect_uri: "Test_Seller-TestApp-SBX-abcdef",
    });

    expect(tokens).toEqual({
      accessToken: "access-token-1",
      accessTokenExpiresAt: new Date("2026-01-01T02:00:00Z"),
      refreshToken: "refresh-token-1",
      refreshTokenExpiresAt: new Date(now.getTime() + 47_304_000 * 1000),
    });
  });

  it("maps invalid_grant (expired/used code) to an authorization error, without retrying", async () => {
    const { ebay, client } = setup();
    ebay.respond(invalidGrant());
    await expect(client.exchangeCode("old")).rejects.toBeInstanceOf(EbayAuthorizationError);
    expect(ebay.requests).toHaveLength(1);
  });

  it("rejects an unexpected response shape", async () => {
    const { ebay, client } = setup();
    ebay.respond({ status: 200, body: { access_token: "x" } });
    await expect(client.exchangeCode("c")).rejects.toThrow("Unexpected token response from eBay");
  });
});

describe("refreshAccessToken", () => {
  it("sends the refresh grant with the configured scopes", async () => {
    const { ebay, client } = setup();
    ebay.respond(refreshResponse("fresh"));

    const result = await client.refreshAccessToken("refresh-token-1");

    expect(Object.fromEntries(ebay.requests[0]!.form)).toEqual({
      grant_type: "refresh_token",
      refresh_token: "refresh-token-1",
      scope: "https://api.ebay.com/oauth/api_scope https://api.ebay.com/oauth/api_scope/sell.fulfillment",
    });
    expect(result).toEqual({ accessToken: "fresh", accessTokenExpiresAt: new Date("2026-01-01T02:00:00Z") });
  });

  it("keeps a rotated refresh token if eBay returns one", async () => {
    const { ebay, client } = setup();
    ebay.respond(tokenResponse({ access_token: "a2", refresh_token: "r2" }));
    const result = await client.refreshAccessToken("r1");
    expect(result.refreshToken).toBe("r2");
    expect(result.refreshTokenExpiresAt).toBeInstanceOf(Date);
  });

  it("retries temporary failures (network, 5xx, 429) and then succeeds", async () => {
    const { ebay, client } = setup();
    ebay.respond({ networkError: true }, serverError(503), refreshResponse("after-retries"));
    expect((await client.refreshAccessToken("r")).accessToken).toBe("after-retries");
    expect(ebay.requests).toHaveLength(3);
  });

  it("reports eBay as unavailable after exhausting retries", async () => {
    const { ebay, client } = setup();
    ebay.respond(serverError(500), serverError(502), { status: 429, body: {} });
    await expect(client.refreshAccessToken("r")).rejects.toBeInstanceOf(EbayUnavailableError);
    expect(ebay.requests).toHaveLength(3);
  });

  it("treats a revoked refresh token (invalid_grant) as reconnect-required", async () => {
    const { ebay, client } = setup();
    ebay.respond(invalidGrant());
    await expect(client.refreshAccessToken("revoked")).rejects.toBeInstanceOf(EbayAuthorizationError);
  });

  it("surfaces other client errors without retrying", async () => {
    const { ebay, client } = setup();
    ebay.respond({ status: 400, body: { error: "invalid_scope" } });
    const error = await client.refreshAccessToken("r").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EbayRequestError);
    expect((error as EbayRequestError).ebayError).toBe("invalid_scope");
    expect(ebay.requests).toHaveLength(1);
  });
});
