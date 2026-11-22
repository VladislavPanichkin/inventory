import { describe, expect, it } from "vitest";
import { assertPasswordPolicy } from "../../src/modules/authentication/admin-account.js";
import { hashPassword, verifyPassword } from "../../src/modules/authentication/password.js";
import { generateSessionToken, hashSessionToken } from "../../src/modules/authentication/session-token.js";

describe("password hashing (Argon2id)", () => {
  it("produces a salted, self-describing argon2id hash that verifies", async () => {
    const a = await hashPassword("correct horse battery staple");
    const b = await hashPassword("correct horse battery staple");

    expect(a).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(a).not.toBe(b); // unique salt per hash
    expect(await verifyPassword("correct horse battery staple", a)).toBe(true);
    expect(await verifyPassword("wrong password", a)).toBe(false);
  });

  it("treats a malformed hash as a failed verification", async () => {
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
  });

  it("enforces a minimum length", () => {
    expect(() => assertPasswordPolicy("short")).toThrow(/at least 12/);
    expect(() => assertPasswordPolicy("long-enough-pass")).not.toThrow();
  });
});

describe("session tokens", () => {
  it("are 256-bit, URL-safe and unique", () => {
    const token = generateSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateSessionToken()).not.toBe(token);
  });

  it("are stored as a deterministic SHA-256 hex digest", async () => {
    expect(await hashSessionToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
