import { createApp } from "../../src/app.js";
import { createLogger } from "../../src/common/logger.js";
import type { AppDeps } from "../../src/common/router.js";
import { loadConfig } from "../../src/config/env.js";
import type { Database } from "../../src/infrastructure/database.js";
import { createMemoryImageStorage } from "../../src/infrastructure/image-storage.js";
import { setAdminCredentials } from "../../src/modules/authentication/admin-account.js";
import { TEST_ADMIN_EMAIL } from "./helpers.js";

export const ADMIN_EMAIL = TEST_ADMIN_EMAIL;
export const ADMIN_PASSWORD = "integration-test-password";

export function createTestApp(
  db: Database,
  overrides: Partial<AppDeps> = {},
  env: Record<string, string | undefined> = {},
) {
  const config = loadConfig({ DATABASE_URL: "unused", NODE_ENV: "test", DEFAULT_CURRENCY: "EUR", ...env });
  return createApp({
    config,
    db,
    logger: createLogger({ sink: () => {} }),
    imageStorage: createMemoryImageStorage(),
    ...overrides,
  });
}

type App = ReturnType<typeof createTestApp>;

/** A tiny HTTP client that behaves like the frontend (JSON, CSRF header, session cookie). */
export function client(app: App, cookie?: string) {
  const request = (method: string, path: string, body?: unknown) =>
    app.request(`http://localhost${path}`, {
      method,
      headers: {
        Accept: "application/json",
        "X-Requested-With": "fetch",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  /** Multipart upload, as the browser sends it (the runtime sets the multipart boundary header). */
  const upload = (path: string, files: Record<string, Uint8Array>) => {
    const form = new FormData();
    for (const [field, bytes] of Object.entries(files)) {
      form.append(field, new File([bytes as Uint8Array<ArrayBuffer>], `${field}.jpg`, { type: "image/jpeg" }));
    }
    return app.request(`http://localhost${path}`, {
      method: "POST",
      headers: { Accept: "application/json", "X-Requested-With": "fetch", ...(cookie ? { Cookie: cookie } : {}) },
      body: form,
    });
  };

  return {
    get: (path: string) => request("GET", path),
    post: (path: string, body?: unknown) => request("POST", path, body),
    put: (path: string, body?: unknown) => request("PUT", path, body),
    patch: (path: string, body?: unknown) => request("PATCH", path, body),
    delete: (path: string) => request("DELETE", path),
    upload,
  };
}

/** Extracts `name=value` from a Set-Cookie header. */
export function cookieFrom(res: Response): string | undefined {
  return res.headers.get("set-cookie")?.split(";")[0];
}

/** Creates the admin and returns an authenticated client. */
export async function loginAsAdmin(db: Database, app: App) {
  await setAdminCredentials(db, ADMIN_EMAIL, ADMIN_PASSWORD);
  const res = await client(app).post("/api/v1/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (res.status !== 200) throw new Error(`Login failed with ${res.status}`);
  const cookie = cookieFrom(res)!;
  return { cookie, api: client(app, cookie) };
}

export async function json<T = any>(res: Response): Promise<T> {
  return (await res.json()) as T;
}
