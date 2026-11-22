import type { MiddlewareHandler } from "hono";
import { API_PREFIX } from "../../common/api-prefix.js";
import { errorBody } from "../../common/http.js";
import type { AppDeps, AppEnv } from "../../common/router.js";
import { DEMO_EBAY_CONNECT_PATH, DEMO_EBAY_DISCONNECT_PATH } from "./demo-ebay.routes.js";
import type { DemoService } from "./demo.service.js";

/**
 * The only parts of the API the demo account may use. Anything else (eBay today, whatever is
 * added later) is refused, so a new module is closed to the demo account unless listed here.
 */
export const DEMO_ALLOWED_PREFIXES = ["/auth/", "/health", "/products", "/images/", "/sales", "/dashboard/", "/demo/"].map(
  (path) => `${API_PREFIX}${path}`,
);

/**
 * Requests that don't use up the change allowance although they aren't reads: connecting and
 * disconnecting the simulated eBay account only flips one flag and creates nothing.
 */
const FREE_PATHS = new Set([DEMO_EBAY_CONNECT_PATH, DEMO_EBAY_DISCONNECT_PATH].map((path) => `${API_PREFIX}${path}`));

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Restrictions for the demo account. Runs after the auth guard; does nothing for the
 * administrator or for requests without a session.
 *
 * - Only the allowed parts of the API are reachable.
 * - Every change (create, edit, status change, photo upload/removal/reorder, delete, adding
 *   sample eBay listings) uses one unit of the allowance. A request that fails gives its unit back.
 */
export function demoRestrictions(deps: AppDeps, demo: DemoService): MiddlewareHandler<AppEnv> {
  const limit = deps.config.DEMO_CHANGE_LIMIT;

  return async (c, next) => {
    const user = c.get("admin");
    if (!user || user.role !== "DEMO") return next();

    if (!DEMO_ALLOWED_PREFIXES.some((prefix) => c.req.path.startsWith(prefix))) {
      return c.json(
        errorBody("DEMO_NOT_AVAILABLE", "This feature is switched off for the demo account.", undefined, c.get("requestId")),
        403,
      );
    }
    if (READ_METHODS.has(c.req.method) || FREE_PATHS.has(c.req.path)) return next();

    if (!(await demo.reserveChange(user.id))) {
      return c.json(
        errorBody(
          "DEMO_LIMIT_REACHED",
          `The demo account allows ${limit} ${limit === 1 ? "change" : "changes"}. Sign out and in again to start over with fresh sample data.`,
          undefined,
          c.get("requestId"),
        ),
        403,
      );
    }
    try {
      await next();
    } catch (error) {
      await demo.refundChange(user.id);
      throw error;
    }
    if (c.res.status >= 400) await demo.refundChange(user.id);
  };
}
