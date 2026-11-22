import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createLogger } from "../../src/common/logger.js";
import { loadConfig } from "../../src/config/env.js";
import type { Database } from "../../src/infrastructure/database.js";
import { createMemoryImageStorage } from "../../src/infrastructure/image-storage.js";
import {
  accountDeletionEndpointUrl,
  computeChallengeResponse,
} from "../../src/modules/ebay/ebay-account-deletion.routes.js";

const TOKEN = "test-verification-token-0123456789abcdef";
const PATH = "/api/v1/webhooks/ebay/account-deletion";
const FRONTEND_URL = "https://inventory.example.com";

/** A database that fails on any use: these routes must never touch it. */
const untouchableDb = new Proxy({}, { get: () => () => Promise.reject(new Error("database must not be used")) }) as Database;

function appWith(env: Record<string, string | undefined>) {
  const logged: unknown[] = [];
  const app = createApp({
    config: loadConfig({ DATABASE_URL: "postgresql://unused", NODE_ENV: "test", FRONTEND_URL, ...env }),
    db: untouchableDb,
    logger: createLogger({ sink: (line) => logged.push(line) }),
    imageStorage: createMemoryImageStorage(),
  });
  return { app, logged };
}

/** The reference computation from eBay's SDK: sequential hash updates, hex digest. */
function referenceResponse(challengeCode: string, token: string, endpoint: string) {
  const hash = createHash("sha256");
  hash.update(challengeCode);
  hash.update(token);
  hash.update(endpoint);
  return hash.digest("hex");
}

describe("account deletion endpoint URL", () => {
  it("is built from the public app address", () => {
    expect(accountDeletionEndpointUrl({ FRONTEND_URL })).toBe(`${FRONTEND_URL}${PATH}`);
    expect(accountDeletionEndpointUrl({ FRONTEND_URL: `${FRONTEND_URL}/` })).toBe(`${FRONTEND_URL}${PATH}`);
  });
});

describe("computeChallengeResponse", () => {
  it("matches eBay's reference computation", async () => {
    const endpoint = `${FRONTEND_URL}${PATH}`;
    await expect(computeChallengeResponse("a8628072-3d33-45ee-9004-bee86830a22d", TOKEN, endpoint)).resolves.toBe(
      referenceResponse("a8628072-3d33-45ee-9004-bee86830a22d", TOKEN, endpoint),
    );
  });
});

describe("GET account deletion endpoint (eBay validation)", () => {
  it("answers the challenge without a session", async () => {
    const { app } = appWith({ EBAY_VERIFICATION_TOKEN: TOKEN });
    const res = await app.request(`${PATH}?challenge_code=abc123`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({
      challengeResponse: referenceResponse("abc123", TOKEN, `${FRONTEND_URL}${PATH}`),
    });
  });

  it("rejects a request without a challenge code", async () => {
    const { app } = appWith({ EBAY_VERIFICATION_TOKEN: TOKEN });
    expect((await app.request(PATH)).status).toBe(400);
  });

  it("is switched off when no verification token is configured", async () => {
    const { app } = appWith({});
    expect((await app.request(`${PATH}?challenge_code=abc123`)).status).toBe(404);
    expect((await app.request(PATH, { method: "POST", body: "{}" })).status).toBe(404);
  });
});

describe("POST account deletion notice", () => {
  const notice = JSON.stringify({
    metadata: { topic: "MARKETPLACE_ACCOUNT_DELETION" },
    notification: { notificationId: "n-1", data: { username: "some_buyer", userId: "U123" } },
  });

  it("acknowledges with 204 without a session or CSRF header, and stores nothing", async () => {
    const { app, logged } = appWith({ EBAY_VERIFICATION_TOKEN: TOKEN });
    const res = await app.request(PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-ebay-signature": "anything" },
      body: notice,
    });

    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    // The user named in the notice must not end up in the logs either.
    expect(JSON.stringify(logged)).not.toContain("some_buyer");
    expect(JSON.stringify(logged)).not.toContain("U123");
  });

  it("acknowledges even a malformed body", async () => {
    const { app } = appWith({ EBAY_VERIFICATION_TOKEN: TOKEN });
    const res = await app.request(PATH, { method: "POST", body: "not json" });
    expect(res.status).toBe(204);
  });
});

describe("other routes stay protected", () => {
  it("does not open neighbouring webhook paths or the API", async () => {
    const { app } = appWith({ EBAY_VERIFICATION_TOKEN: TOKEN });
    expect((await app.request("/api/v1/webhooks/ebay/other")).status).toBe(404);
    expect((await app.request("/api/v1/products")).status).toBe(401);
  });
});
