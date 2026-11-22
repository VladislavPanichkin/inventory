import { swaggerUI } from "@hono/swagger-ui";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { API_PREFIX } from "./common/api-prefix.js";
import { CSRF_HEADER, csrfProtection } from "./common/csrf.js";
import { AppError } from "./common/errors.js";
import { errorBody } from "./common/http.js";
import { createMemoryRateLimitStore, rateLimit } from "./common/rate-limit.js";
import { createRouter, type AppDeps } from "./common/router.js";
import { APP_VERSION } from "./common/version.js";
import { Prisma } from "./generated/prisma/client.js";
import { requireAdmin } from "./modules/authentication/auth.middleware.js";
import { createAuthRoutes } from "./modules/authentication/auth.routes.js";
import { createAuthService } from "./modules/authentication/auth.service.js";
import { sessionCookieName } from "./modules/authentication/session-cookie.js";
import { createDashboardRoutes } from "./modules/dashboard/dashboard.routes.js";
import { createDemoEbayRoutes } from "./modules/demo/demo-ebay.routes.js";
import { createDemoEbayService } from "./modules/demo/demo-ebay.service.js";
import { demoRestrictions } from "./modules/demo/demo.middleware.js";
import { createDemoService } from "./modules/demo/demo.service.js";
import { createEbayAccountDeletionRoutes } from "./modules/ebay/ebay-account-deletion.routes.js";
import { createEbayAccountService } from "./modules/ebay/ebay-account.service.js";
import { createEbayListingsRoutes } from "./modules/ebay/ebay-listings.routes.js";
import { createEbayListingsService } from "./modules/ebay/ebay-listings.service.js";
import { createEbayRoutes } from "./modules/ebay/ebay.routes.js";
import { createHealthRoutes } from "./modules/health/health.routes.js";
import { createImageRoutes } from "./modules/images/images.routes.js";
import { createProductRoutes } from "./modules/products/products.routes.js";
import { createSalesRoutes } from "./modules/sales/sales.routes.js";

export { API_PREFIX };

/**
 * Routes the JSON auth guard lets through. Everything else under /api/v1 is protected.
 * The eBay connect/callback routes are browser navigations: they verify the admin session
 * themselves and redirect to the login page instead of answering with a JSON 401.
 */
export const PUBLIC_PATHS = [
  `${API_PREFIX}/health`,
  `${API_PREFIX}/auth/login`,
  `${API_PREFIX}/auth/logout`,
  `${API_PREFIX}/integrations/ebay/connect`,
  `${API_PREFIX}/integrations/ebay/callback`,
];
/**
 * Endpoints called by eBay itself, so they carry no session and no CSRF header.
 * Only the account-deletion endpoint lives here; it takes no action on what it receives.
 */
export const WEBHOOK_PREFIX = `${API_PREFIX}/webhooks/`;

export const RATE_LIMITS = {
  api: { limit: 600, windowMs: 60_000 },
  login: { limit: 10, windowMs: 15 * 60_000 },
} as const;

/**
 * Builds the HTTP application. Runtime-agnostic: uses only Hono + Web APIs,
 * so it can be served by Node (src/server.ts) or, later, a Workers entry point.
 */
export function createApp(deps: AppDeps) {
  const app = createRouter();
  const rateLimitStore = deps.rateLimitStore ?? createMemoryRateLimitStore();
  const clientKey = (c: Parameters<NonNullable<AppDeps["getClientIp"]>>[0]) => deps.getClientIp?.(c) ?? "unknown";
  const authService = createAuthService(deps);

  app.use("*", requestId());
  app.use("*", secureHeaders());
  app.use(
    "/api/*",
    cors({
      origin: deps.config.FRONTEND_URL,
      credentials: true,
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", CSRF_HEADER],
    }),
  );

  // Access log: method, path, status, duration. Never logs bodies, cookies or headers.
  app.use("*", async (c, next) => {
    const started = performance.now();
    await next();
    deps.logger.info("request", {
      requestId: c.get("requestId"),
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Math.round(performance.now() - started),
    });
  });

  app.use(`${API_PREFIX}/*`, rateLimit({ store: rateLimitStore, name: "api", key: clientKey, ...RATE_LIMITS.api }));
  app.use(
    `${API_PREFIX}/auth/login`,
    rateLimit({ store: rateLimitStore, name: "login", key: clientKey, ...RATE_LIMITS.login }),
  );
  app.use(
    `${API_PREFIX}/*`,
    csrfProtection({ allowedOrigins: [deps.config.FRONTEND_URL], exemptPrefixes: [WEBHOOK_PREFIX] }),
  );
  const docsEnabled = deps.config.NODE_ENV !== "production";
  const docsPaths = [`${API_PREFIX}/openapi.json`, `${API_PREFIX}/docs`];
  app.use(
    `${API_PREFIX}/*`,
    requireAdmin(deps, authService, {
      publicPaths: docsEnabled ? [...PUBLIC_PATHS, ...docsPaths] : PUBLIC_PATHS,
      publicPrefixes: [WEBHOOK_PREFIX],
    }),
  );
  // After the guard: limits what the demo account can reach and how many changes it can make.
  app.use(`${API_PREFIX}/*`, demoRestrictions(deps, createDemoService(deps)));

  app.route(API_PREFIX, createHealthRoutes(deps));
  app.route(API_PREFIX, createAuthRoutes(deps, authService));
  app.route(API_PREFIX, createProductRoutes(deps));
  app.route(API_PREFIX, createImageRoutes(deps));
  app.route(API_PREFIX, createSalesRoutes(deps));
  app.route(API_PREFIX, createDashboardRoutes(deps));
  const ebayAccount = createEbayAccountService(deps);
  app.route(API_PREFIX, createEbayRoutes(deps, authService, ebayAccount));
  app.route(API_PREFIX, createEbayListingsRoutes(createEbayListingsService(deps, ebayAccount)));
  app.route(API_PREFIX, createEbayAccountDeletionRoutes(deps));
  // Simulated eBay for the demo account (sample seller, sample listings). Never reaches eBay.
  app.route(API_PREFIX, createDemoEbayRoutes(createDemoEbayService(deps)));

  // API documentation (public in development only; disabled in production).
  if (docsEnabled) {
    app.openAPIRegistry.registerComponent("securitySchemes", "cookieAuth", {
      type: "apiKey",
      in: "cookie",
      name: sessionCookieName(deps.config),
      description: `Session cookie set by POST ${API_PREFIX}/auth/login. Mutating requests also need the ${CSRF_HEADER} header.`,
    });
    app.doc(`${API_PREFIX}/openapi.json`, {
      openapi: "3.0.3",
      info: { title: "Inventory Management API", version: APP_VERSION },
    });
    app.get(`${API_PREFIX}/docs`, swaggerUI({ url: `${API_PREFIX}/openapi.json` }));
  }

  app.notFound((c) =>
    c.json(errorBody("NOT_FOUND", `Route ${c.req.method} ${c.req.path} not found`, undefined, c.get("requestId")), 404),
  );

  app.onError((error, c) => {
    const id = c.get("requestId");
    if (error instanceof AppError) {
      if (error.status >= 500) deps.logger.error(error.message, { requestId: id, code: error.code });
      return c.json(errorBody(error.code, error.message, error.details, id), error.status);
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      // Fallbacks for constraint errors a service didn't translate itself.
      if (error.code === "P2002") return c.json(errorBody("CONFLICT", "Resource already exists", undefined, id), 409);
      if (error.code === "P2025") return c.json(errorBody("NOT_FOUND", "Resource not found", undefined, id), 404);
    }
    if (error instanceof HTTPException) {
      return c.json(errorBody("HTTP_ERROR", error.message || "Request failed", undefined, id), error.status);
    }
    deps.logger.error("Unhandled error", { requestId: id, error });
    return c.json(errorBody("INTERNAL_ERROR", "An unexpected error occurred", undefined, id), 500);
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
