import { describe, expect, it } from "vitest";
import { ConfigError, isEbayConfigured, loadConfig } from "../../src/config/env.js";

const VALID_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const base = { DATABASE_URL: "postgresql://u:p@localhost:5432/db" };

describe("loadConfig", () => {
  it("applies defaults", () => {
    const config = loadConfig(base);
    expect(config).toMatchObject({
      NODE_ENV: "development",
      PORT: 3000,
      FRONTEND_URL: "http://localhost:5173",
      DEFAULT_CURRENCY: "EUR",
      EBAY_ENVIRONMENT: "sandbox",
      EBAY_MARKETPLACE_ID: "EBAY_DE",
    });
  });

  it("coerces PORT and treats empty strings as unset", () => {
    const config = loadConfig({ ...base, PORT: "8080", EBAY_CLIENT_ID: "", TOKEN_ENCRYPTION_KEY: "  " });
    expect(config.PORT).toBe(8080);
    expect(config.EBAY_CLIENT_ID).toBeUndefined();
    expect(config.TOKEN_ENCRYPTION_KEY).toBeUndefined();
  });

  it("requires DATABASE_URL", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
  });

  it("rejects an encryption key that is not 32 bytes and never echoes the value", () => {
    const secret = btoa("too-short-secret-value");
    try {
      loadConfig({ ...base, TOKEN_ENCRYPTION_KEY: secret });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as Error).message).toContain("TOKEN_ENCRYPTION_KEY");
      expect((error as Error).message).not.toContain(secret);
    }
  });

  it("requires an encryption key and an https FRONTEND_URL in production", () => {
    const prod = { ...base, NODE_ENV: "production", FRONTEND_URL: "https://inventory.example.com", IMAGE_STORAGE: "local" };
    expect(() => loadConfig({ ...prod, TOKEN_ENCRYPTION_KEY: undefined })).toThrow(/TOKEN_ENCRYPTION_KEY/);
    expect(() => loadConfig({ ...prod, TOKEN_ENCRYPTION_KEY: VALID_KEY, FRONTEND_URL: "http://localhost:5173" })).toThrow(
      /FRONTEND_URL: must be an https/,
    );
    expect(loadConfig({ ...prod, TOKEN_ENCRYPTION_KEY: VALID_KEY }).NODE_ENV).toBe("production");
  });

  it("parses proxy trust and optional first-start admin settings", () => {
    expect(loadConfig(base).TRUST_PROXY).toBe(false);
    expect(loadConfig({ ...base, TRUST_PROXY: "true" }).TRUST_PROXY).toBe(true);
    expect(() => loadConfig({ ...base, TRUST_PROXY: "yes" })).toThrow(/TRUST_PROXY/);
    expect(loadConfig({ ...base, ADMIN_EMAIL: "", ADMIN_PASSWORD: "" })).toMatchObject({
      ADMIN_EMAIL: undefined,
      ADMIN_PASSWORD: undefined,
    });
    expect(() => loadConfig({ ...base, ADMIN_EMAIL: "not-an-email" })).toThrow(/ADMIN_EMAIL/);
  });

  it("rejects a malformed currency", () => {
    expect(() => loadConfig({ ...base, DEFAULT_CURRENCY: "euro" })).toThrow(/DEFAULT_CURRENCY/);
  });

  it("defaults eBay scopes to the confirmed list and accepts a space-separated override", () => {
    expect(loadConfig(base).EBAY_SCOPES).toEqual([
      "https://api.ebay.com/oauth/api_scope",
      "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
    ]);
    expect(loadConfig({ ...base, EBAY_SCOPES: "  https://a.example/x   https://a.example/y " }).EBAY_SCOPES).toEqual([
      "https://a.example/x",
      "https://a.example/y",
    ]);
    expect(() => loadConfig({ ...base, EBAY_SCOPES: "not-a-url" })).toThrow(/EBAY_SCOPES/);
  });
});

describe("isEbayConfigured", () => {
  it("is true only when all OAuth settings and the encryption key are present", () => {
    const partial = loadConfig({ ...base, EBAY_CLIENT_ID: "id", EBAY_CLIENT_SECRET: "secret" });
    expect(isEbayConfigured(partial)).toBe(false);

    const full = loadConfig({
      ...base,
      EBAY_CLIENT_ID: "id",
      EBAY_CLIENT_SECRET: "secret",
      EBAY_RU_NAME: "ru-name",
      TOKEN_ENCRYPTION_KEY: VALID_KEY,
    });
    expect(isEbayConfigured(full)).toBe(true);
  });
});
