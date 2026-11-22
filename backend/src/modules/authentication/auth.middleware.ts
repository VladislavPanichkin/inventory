import type { MiddlewareHandler } from "hono";
import { errorBody } from "../../common/http.js";
import { nowFrom, type AppDeps, type AppEnv } from "../../common/router.js";
import type { AuthService } from "./auth.service.js";
import { clearSessionCookie, readSessionCookie, writeSessionCookie } from "./session-cookie.js";

export interface AuthGuardOptions {
  /** Exact paths reachable without a session. */
  publicPaths: string[];
  /** Path prefixes reachable without a session (e.g. signature-verified webhooks). */
  publicPrefixes: string[];
}

/**
 * Protects every API route by default; only explicitly listed paths are public.
 * (Deny-by-default, so a new route can't accidentally be left unprotected.)
 */
export function requireAdmin(deps: AppDeps, auth: AuthService, options: AuthGuardOptions): MiddlewareHandler<AppEnv> {
  const publicPaths = new Set(options.publicPaths);

  return async (c, next) => {
    const path = c.req.path;
    if (c.req.method === "OPTIONS" || publicPaths.has(path) || options.publicPrefixes.some((p) => path.startsWith(p))) {
      return next();
    }

    const token = readSessionCookie(c, deps.config);
    const session = token ? await auth.authenticate(token) : null;
    if (!session) {
      if (token) clearSessionCookie(c, deps.config);
      return c.json(errorBody("UNAUTHORIZED", "Authentication required", undefined, c.get("requestId")), 401);
    }

    if (session.renewedExpiresAt && token) {
      writeSessionCookie(c, deps.config, token, session.renewedExpiresAt, nowFrom(deps));
    }
    c.set("admin", { ...session.admin, sessionId: session.sessionId });
    return next();
  };
}
