import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "../../src/common/logger.js";
import { loadConfig } from "../../src/config/env.js";
import { createMemoryImageStorage } from "../../src/infrastructure/image-storage.js";
import { createEbayAccountService, OAUTH_STATE_TTL_MS } from "../../src/modules/ebay/ebay-account.service.js";
import { EbayAuthorizationError, EbayNotConnectedError } from "../../src/modules/ebay/ebay-errors.js";
import { createFakeEbay, invalidGrant, refreshResponse, serverError, TEST_EBAY_ENV, tokenResponse } from "../support/fake-ebay.js";
import { ADMIN_EMAIL, ADMIN_PASSWORD, client, cookieFrom, createTestApp, json, loginAsAdmin } from "./app-client.js";
import { createTestDatabase, resetDatabase } from "./helpers.js";

const db = createTestDatabase();

let clock: Date;
let ebay: ReturnType<typeof createFakeEbay>;

beforeEach(async () => {
  await resetDatabase(db);
  clock = new Date("2026-03-01T10:00:00Z");
  ebay = createFakeEbay();
});

afterAll(async () => {
  await db.$disconnect();
});

function setup(env: Record<string, string> = TEST_EBAY_ENV) {
  return createTestApp(db, { fetch: ebay.fetch, now: () => clock }, env);
}

function service() {
  const config = loadConfig({ DATABASE_URL: "unused", NODE_ENV: "test", ...TEST_EBAY_ENV });
  return createEbayAccountService({
    config,
    db,
    logger: createLogger({ sink: () => {} }),
    imageStorage: createMemoryImageStorage(),
    fetch: ebay.fetch,
    now: () => clock,
  });
}

/** Runs connect → (eBay consent) → callback like a browser would. Returns the callback response. */
async function connectFlow(api: ReturnType<typeof client>, code = "auth-code-1") {
  const connect = await api.get("/api/v1/integrations/ebay/connect");
  const state = new URL(connect.headers.get("location")!).searchParams.get("state")!;
  return {
    state,
    callback: await api.get(
      `/api/v1/integrations/ebay/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}&expires_in=299`,
    ),
  };
}

const location = (res: Response) => res.headers.get("location");

describe("eBay connection status", () => {
  it("reports not configured / not connected and never exposes tokens", async () => {
    const { api } = await loginAsAdmin(db, createTestApp(db));
    const { data } = await json(await api.get("/api/v1/integrations/ebay"));
    expect(data).toMatchObject({ configured: false, connectionStatus: "NOT_CONNECTED", environment: "sandbox" });

    const configured = await json(await (await loginAsAdmin(db, setup())).api.get("/api/v1/integrations/ebay"));
    expect(configured.data).toMatchObject({ configured: true, marketplaceId: "EBAY_DE" });
  });

  it("requires a session", async () => {
    expect((await client(setup()).get("/api/v1/integrations/ebay")).status).toBe(401);
  });
});

describe("connect flow", () => {
  it("redirects to eBay's sandbox consent page with a session-bound, single-use state", async () => {
    const app = setup();
    const { api } = await loginAsAdmin(db, app);

    const res = await api.get("/api/v1/integrations/ebay/connect");
    expect(res.status).toBe(302);
    const url = new URL(location(res)!);
    expect(url.origin).toBe("https://auth.sandbox.ebay.com");
    expect(url.searchParams.get("redirect_uri")).toBe(TEST_EBAY_ENV.EBAY_RU_NAME);

    const stored = await db.oAuthState.findUniqueOrThrow({ where: { state: url.searchParams.get("state")! } });
    const session = await db.adminSession.findFirstOrThrow();
    expect(stored.adminSessionId).toBe(session.id);
    expect(stored.expiresAt.getTime() - clock.getTime()).toBe(OAUTH_STATE_TTL_MS);
  });

  it("completes: exchanges the code, stores tokens encrypted, redirects to settings", async () => {
    const app = setup();
    const { api } = await loginAsAdmin(db, app);
    ebay.respond(tokenResponse());

    const { callback } = await connectFlow(api, "v^1.1#i^1#r^1=");
    expect(callback.status).toBe(302);
    expect(location(callback)).toBe("/settings/ebay?connected=1");
    expect(ebay.requests[0]!.form.get("code")).toBe("v^1.1#i^1#r^1=");

    const account = await db.ebayAccount.findFirstOrThrow();
    expect(account.connectionStatus).toBe("CONNECTED");
    expect(account.refreshTokenEncrypted).toMatch(/^v1\./);
    expect(account.accessTokenEncrypted).toMatch(/^v1\./);
    expect(JSON.stringify(account)).not.toContain("refresh-token-1");
    expect(JSON.stringify(account)).not.toContain("access-token-1");
    expect(account.accessTokenExpiresAt!.getTime() - clock.getTime()).toBe(7200 * 1000);

    const status = await api.get("/api/v1/integrations/ebay");
    const text = await status.text();
    expect(JSON.parse(text).data).toMatchObject({ connectionStatus: "CONNECTED", connectedAt: clock.toISOString() });
    expect(text).not.toMatch(/token-1|v1\./);
  });

  it("rejects a replayed state without calling eBay again", async () => {
    const app = setup();
    const { api } = await loginAsAdmin(db, app);
    ebay.respond(tokenResponse());
    const { state } = await connectFlow(api);

    const replay = await api.get(`/api/v1/integrations/ebay/callback?state=${state}&code=another`);
    expect(location(replay)).toBe("/settings/ebay?error=invalid_state");
    expect(ebay.requests).toHaveLength(1);
  });

  it("rejects an expired state", async () => {
    const app = setup();
    const { api } = await loginAsAdmin(db, app);
    const connect = await api.get("/api/v1/integrations/ebay/connect");
    const state = new URL(location(connect)!).searchParams.get("state")!;

    clock = new Date(clock.getTime() + OAUTH_STATE_TTL_MS + 1);
    const res = await api.get(`/api/v1/integrations/ebay/callback?state=${state}&code=c`);
    expect(location(res)).toBe("/settings/ebay?error=invalid_state");
    expect(ebay.requests).toHaveLength(0);
  });

  it("rejects a state that was issued to a different session", async () => {
    const app = setup();
    const { api: first } = await loginAsAdmin(db, app);
    const connect = await first.get("/api/v1/integrations/ebay/connect");
    const state = new URL(location(connect)!).searchParams.get("state")!;

    const login = await client(app).post("/api/v1/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const second = client(app, cookieFrom(login));
    const res = await second.get(`/api/v1/integrations/ebay/callback?state=${state}&code=c`);
    expect(location(res)).toBe("/settings/ebay?error=invalid_state");
    expect(ebay.requests).toHaveLength(0);
  });

  it("handles a declined consent (no code)", async () => {
    const { api } = await loginAsAdmin(db, setup());
    const res = await api.get("/api/v1/integrations/ebay/callback?error=access_denied");
    expect(location(res)).toBe("/settings/ebay?error=declined");
    expect(await db.ebayAccount.count()).toBe(0);
  });

  it("reports eBay being unavailable during the code exchange", async () => {
    const app = setup();
    const { api } = await loginAsAdmin(db, app);
    ebay.respond(serverError(503));
    const { callback } = await connectFlow(api);
    expect(location(callback)).toBe("/settings/ebay?error=ebay_unavailable");
    expect(await db.ebayAccount.count()).toBe(0);
  });

  it("sends a logged-out browser to the login page instead of a JSON error", async () => {
    const app = setup();
    for (const path of ["/api/v1/integrations/ebay/connect", "/api/v1/integrations/ebay/callback?state=s&code=c"]) {
      const res = await client(app).get(path);
      expect(res.status).toBe(302);
      expect(location(res)).toBe(`/login?next=${encodeURIComponent("/settings/ebay?error=session_expired")}`);
    }
  });

  it("explains when eBay credentials are not configured", async () => {
    const { api } = await loginAsAdmin(db, createTestApp(db));
    const res = await api.get("/api/v1/integrations/ebay/connect");
    expect(location(res)).toBe("/settings/ebay?error=not_configured");
  });
});

describe("access tokens", () => {
  async function connected() {
    const app = setup();
    const { api } = await loginAsAdmin(db, app);
    ebay.respond(tokenResponse());
    await connectFlow(api);
    ebay.requests.length = 0;
    return { app, api };
  }

  it("reuses the stored access token until shortly before expiry, then refreshes", async () => {
    await connected();
    const svc = service();

    expect(await svc.getAccessToken()).toBe("access-token-1");
    expect(ebay.requests).toHaveLength(0);

    clock = new Date(clock.getTime() + 7200 * 1000 - 60_000); // inside the 5-minute margin
    ebay.respond(refreshResponse("access-token-2"));
    expect(await svc.getAccessToken()).toBe("access-token-2");
    expect(ebay.requests[0]!.form.get("refresh_token")).toBe("refresh-token-1");

    // The new token is cached (encrypted) for subsequent calls.
    expect(await svc.getAccessToken()).toBe("access-token-2");
    expect(ebay.requests).toHaveLength(1);
  });

  it("shares one refresh between concurrent callers", async () => {
    await connected();
    clock = new Date(clock.getTime() + 8000 * 1000);
    const svc = service();
    ebay.respond(refreshResponse("shared"));

    const tokens = await Promise.all([svc.getAccessToken(), svc.getAccessToken(), svc.getAccessToken()]);
    expect(tokens).toEqual(["shared", "shared", "shared"]);
    expect(ebay.requests).toHaveLength(1);
  });

  it("marks the account REAUTH_REQUIRED when eBay revokes the refresh token", async () => {
    const { api } = await connected();
    clock = new Date(clock.getTime() + 8000 * 1000);
    ebay.respond(invalidGrant());

    await expect(service().getAccessToken()).rejects.toBeInstanceOf(EbayAuthorizationError);
    const account = await db.ebayAccount.findFirstOrThrow();
    expect(account.connectionStatus).toBe("REAUTH_REQUIRED");
    expect(account.accessTokenEncrypted).toBeNull();
    await expect(service().getAccessToken()).rejects.toBeInstanceOf(EbayNotConnectedError);

    const summary = await json(await api.get("/api/v1/dashboard/summary"));
    expect(summary.data.warnings.map((w: { code: string }) => w.code)).toContain("EBAY_REAUTH_REQUIRED");
  });

  it("can reconnect after reauth is required", async () => {
    const { api } = await connected();
    await db.ebayAccount.updateMany({ data: { connectionStatus: "REAUTH_REQUIRED" } });
    ebay.respond(tokenResponse({ access_token: "new-access", refresh_token: "new-refresh" }));

    const { callback } = await connectFlow(api);
    expect(location(callback)).toBe("/settings/ebay?connected=1");
    expect(await db.ebayAccount.count()).toBe(1);
    expect(await service().getAccessToken()).toBe("new-access");
  });
});

describe("disconnect", () => {
  it("forgets all tokens but keeps the account row", async () => {
    const app = setup();
    const { api } = await loginAsAdmin(db, app);
    ebay.respond(tokenResponse());
    await connectFlow(api);

    const res = await api.post("/api/v1/integrations/ebay/disconnect");
    expect(res.status).toBe(200);
    expect((await json(res)).data.connectionStatus).toBe("DISCONNECTED");

    const account = await db.ebayAccount.findFirstOrThrow();
    expect(account).toMatchObject({
      connectionStatus: "DISCONNECTED",
      refreshTokenEncrypted: null,
      accessTokenEncrypted: null,
      refreshTokenExpiresAt: null,
    });
    await expect(service().getAccessToken()).rejects.toBeInstanceOf(EbayNotConnectedError);
  });

  it("requires the CSRF header like every other change", async () => {
    const app = setup();
    const { cookie } = await loginAsAdmin(db, app);
    const res = await app.request("http://localhost/api/v1/integrations/ebay/disconnect", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(403);
  });
});
