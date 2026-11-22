import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createMemoryRateLimitStore } from "../../src/common/rate-limit.js";
import { RATE_LIMITS } from "../../src/app.js";
import { SESSION_IDLE_TTL_MS, SESSION_TOUCH_INTERVAL_MS } from "../../src/modules/authentication/auth.service.js";
import { setAdminCredentials } from "../../src/modules/authentication/admin-account.js";
import { ADMIN_EMAIL, ADMIN_PASSWORD, client, cookieFrom, createTestApp, json, loginAsAdmin } from "./app-client.js";
import { createTestDatabase, resetDatabase } from "./helpers.js";

const db = createTestDatabase();

beforeEach(async () => {
  await resetDatabase(db);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("authentication", () => {
  it("logs in with valid credentials and sets a secure session cookie", async () => {
    await setAdminCredentials(db, ADMIN_EMAIL, ADMIN_PASSWORD);
    const app = createTestApp(db);

    const res = await client(app).post("/api/v1/auth/login", { email: " Admin@Example.com ", password: ADMIN_PASSWORD });
    expect(res.status).toBe(200);
    expect((await json(res)).data.email).toBe(ADMIN_EMAIL);

    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/^inventory_session=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\//);

    // Only a hash of the token is stored.
    const token = cookieFrom(res)!.split("=")[1]!;
    const session = await db.adminSession.findFirstOrThrow();
    expect(session.tokenHash).not.toBe(token);
    expect(session.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects wrong passwords and unknown emails with the same response", async () => {
    await setAdminCredentials(db, ADMIN_EMAIL, ADMIN_PASSWORD);
    const app = createTestApp(db);

    const wrongPassword = await client(app).post("/api/v1/auth/login", { email: ADMIN_EMAIL, password: "nope-nope-nope" });
    const unknownEmail = await client(app).post("/api/v1/auth/login", { email: "x@example.com", password: ADMIN_PASSWORD });

    for (const res of [wrongPassword, unknownEmail]) {
      expect(res.status).toBe(401);
      expect((await json(res)).error.code).toBe("INVALID_CREDENTIALS");
      expect(res.headers.get("set-cookie")).toBeNull();
    }
  });

  it("validates the login body", async () => {
    const res = await client(createTestApp(db)).post("/api/v1/auth/login", { email: "not-an-email", password: "" });
    expect(res.status).toBe(400);
    expect((await json(res)).error.code).toBe("VALIDATION_ERROR");
  });

  it("returns the current admin with a session, 401 without", async () => {
    const app = createTestApp(db);
    const { api } = await loginAsAdmin(db, app);

    expect((await json(await api.get("/api/v1/auth/me"))).data.email).toBe(ADMIN_EMAIL);
    expect((await client(app).get("/api/v1/auth/me")).status).toBe(401);
    expect((await client(app, "inventory_session=forged").get("/api/v1/auth/me")).status).toBe(401);
  });

  it("logout invalidates the session server-side", async () => {
    const app = createTestApp(db);
    const { api } = await loginAsAdmin(db, app);

    const res = await api.post("/api/v1/auth/logout");
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    // Replaying the old cookie no longer works.
    expect((await api.get("/api/v1/auth/me")).status).toBe(401);
    expect(await db.adminSession.count()).toBe(0);
  });

  it("expires idle sessions and slides active ones", async () => {
    let now = new Date("2026-01-01T00:00:00Z");
    const app = createTestApp(db, { now: () => now });
    const { api } = await loginAsAdmin(db, app);
    // loginAsAdmin used the fixed clock; the session expires at now + idle TTL.

    now = new Date(now.getTime() + SESSION_TOUCH_INTERVAL_MS + 1000);
    const touched = await api.get("/api/v1/auth/me");
    expect(touched.status).toBe(200);
    expect(touched.headers.get("set-cookie")).toMatch(/inventory_session=/); // cookie re-issued

    now = new Date(now.getTime() + SESSION_IDLE_TTL_MS + 1000);
    expect((await api.get("/api/v1/auth/me")).status).toBe(401);
  });

  it("changing the password revokes existing sessions", async () => {
    const app = createTestApp(db);
    const { api } = await loginAsAdmin(db, app);
    await setAdminCredentials(db, ADMIN_EMAIL, "a-brand-new-password");
    expect((await api.get("/api/v1/auth/me")).status).toBe(401);
  });

  it("rate limits login attempts per client", async () => {
    const app = createTestApp(db, { rateLimitStore: createMemoryRateLimitStore(), getClientIp: () => "203.0.113.9" });
    const attempt = () => client(app).post("/api/v1/auth/login", { email: "x@example.com", password: "wrong-password" });

    for (let i = 0; i < RATE_LIMITS.login.limit; i++) expect((await attempt()).status).toBe(401);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).not.toBeNull();
  });
});
