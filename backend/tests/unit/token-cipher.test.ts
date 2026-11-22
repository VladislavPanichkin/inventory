import { describe, expect, it } from "vitest";
import { createTokenCipher, TokenCipherError } from "../../src/infrastructure/token-cipher.js";
import { TEST_EBAY_ENV } from "../support/fake-ebay.js";

const key = TEST_EBAY_ENV.TOKEN_ENCRYPTION_KEY;
const otherKey = btoa("x".repeat(32));

describe("token cipher (AES-256-GCM)", () => {
  it("round-trips and never stores the plaintext", async () => {
    const cipher = createTokenCipher(key);
    const encrypted = await cipher.encrypt("v^1.1#i^1#r^1#refresh-token");
    expect(encrypted).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(encrypted).not.toContain("refresh-token");
    expect(await cipher.decrypt(encrypted)).toBe("v^1.1#i^1#r^1#refresh-token");
  });

  it("uses a fresh IV per encryption", async () => {
    const cipher = createTokenCipher(key);
    expect(await cipher.encrypt("same")).not.toBe(await cipher.encrypt("same"));
  });

  it("detects tampering and wrong keys without leaking data", async () => {
    const encrypted = await createTokenCipher(key).encrypt("secret");
    const [v, iv, data] = encrypted.split(".");
    const flipped = `${v}.${iv}.${data!.slice(0, -2)}${data!.endsWith("A") ? "B" : "A"}${data!.slice(-1)}`;

    await expect(createTokenCipher(key).decrypt(flipped)).rejects.toBeInstanceOf(TokenCipherError);
    await expect(createTokenCipher(otherKey).decrypt(encrypted)).rejects.toThrow("Could not decrypt payload");
    await expect(createTokenCipher(key).decrypt("garbage")).rejects.toThrow("Unsupported encrypted payload format");
  });

  it("rejects keys that are not 32 bytes", () => {
    expect(() => createTokenCipher(btoa("short"))).toThrow(TokenCipherError);
  });
});
