import type { MiddlewareHandler } from "hono";
import { errorBody } from "./http.js";

/**
 * CSRF protection for the cookie-authenticated JSON API.
 *
 * Defence in depth on top of SameSite=Lax cookies and a strict CORS allow-list:
 *  1. Unsafe methods must carry `X-Requested-With`. Browsers can't send custom
 *     headers cross-origin without a CORS preflight, which our CORS policy rejects.
 *  2. If an `Origin` header is present it must be an allowed origin.
 *
 * Paths in `exemptPrefixes` (e.g. eBay webhooks, which are signature-verified) are skipped.
 */
export const CSRF_HEADER = "X-Requested-With";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function csrfProtection(options: { allowedOrigins: string[]; exemptPrefixes?: string[] }): MiddlewareHandler {
  const allowed = new Set(options.allowedOrigins.map((origin) => new URL(origin).origin));
  const exempt = options.exemptPrefixes ?? [];

  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method) || exempt.some((prefix) => c.req.path.startsWith(prefix))) {
      return next();
    }

    const origin = c.req.header("Origin");
    const requestOrigin = new URL(c.req.url).origin;
    if (origin && origin !== requestOrigin && !allowed.has(origin)) {
      return c.json(errorBody("CSRF_REJECTED", "Cross-origin request rejected"), 403);
    }
    if (!c.req.header(CSRF_HEADER)) {
      return c.json(errorBody("CSRF_REJECTED", `Missing ${CSRF_HEADER} header`), 403);
    }
    return next();
  };
}
