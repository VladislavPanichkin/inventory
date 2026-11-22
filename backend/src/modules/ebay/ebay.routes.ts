import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { errorResponseSchema } from "../../common/http.js";
import { createRouter, type AppDeps, type AppEnv } from "../../common/router.js";
import type { AuthService } from "../authentication/auth.service.js";
import { readSessionCookie } from "../authentication/session-cookie.js";
import { EbayNotConfiguredError, EbayRequestError, EbayUnavailableError, EbayAuthorizationError } from "./ebay-errors.js";
import { InvalidOAuthStateError, type EbayAccountService } from "./ebay-account.service.js";

/** Frontend page the browser lands on after the OAuth round trip (same origin, relative redirect). */
export const EBAY_SETTINGS_PATH = "/settings/ebay";

/** Machine-readable outcome codes passed to the settings page as ?error=… */
export type ConnectErrorCode =
  | "not_configured"
  | "session_expired"
  | "declined"
  | "invalid_state"
  | "ebay_unavailable"
  | "ebay_rejected"
  | "demo"
  | "unexpected";

export const ebayConnectionSchema = z
  .object({
    configured: z.boolean(),
    environment: z.enum(["sandbox", "production"]),
    connectionStatus: z.enum(["NOT_CONNECTED", "CONNECTED", "DISCONNECTED", "REAUTH_REQUIRED"]),
    sellerUsername: z.string().nullable(),
    marketplaceId: z.string(),
    connectedAt: z.string().nullable(),
    refreshTokenExpiresAt: z.string().nullable(),
    scopes: z.array(z.string()),
    lastErrorMessage: z.string().nullable(),
  })
  .openapi("EbayConnection");

const tags = ["eBay integration"];

const statusRoute = createRoute({
  method: "get",
  path: "/integrations/ebay",
  tags,
  security: [{ cookieAuth: [] }],
  summary: "eBay connection status (never includes tokens or secrets)",
  responses: {
    200: { description: "Status", content: { "application/json": { schema: z.object({ data: ebayConnectionSchema }) } } },
    401: { description: "Not authenticated", content: { "application/json": { schema: errorResponseSchema } } },
  },
});

const connectRoute = createRoute({
  method: "get",
  path: "/integrations/ebay/connect",
  tags,
  summary: "Start the eBay OAuth flow (browser navigation)",
  description: `Redirects (302) to eBay's consent page. On failure redirects to ${EBAY_SETTINGS_PATH}?error=<code>. Requires the admin session cookie.`,
  responses: { 302: { description: "Redirect to eBay or back to the settings page" } },
});

const callbackRoute = createRoute({
  method: "get",
  path: "/integrations/ebay/callback",
  tags,
  summary: "OAuth redirect target (configure as the RuName accept/decline URL)",
  description: `eBay redirects the browser here. Verifies the single-use state (bound to the admin session), exchanges the code and stores tokens encrypted, then redirects to ${EBAY_SETTINGS_PATH}?connected=1 or ?error=<code>.`,
  request: {
    query: z.object({
      code: z.string().optional(),
      state: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  responses: { 302: { description: "Redirect back to the settings page" } },
});

const disconnectRoute = createRoute({
  method: "post",
  path: "/integrations/ebay/disconnect",
  tags,
  security: [{ cookieAuth: [] }],
  summary: "Forget the stored eBay authorization",
  responses: {
    200: { description: "Disconnected", content: { "application/json": { schema: z.object({ data: ebayConnectionSchema }) } } },
    401: { description: "Not authenticated", content: { "application/json": { schema: errorResponseSchema } } },
  },
});

export function createEbayRoutes(deps: AppDeps, auth: AuthService, ebay: EbayAccountService) {
  const router = createRouter();
  const log = deps.logger.child({ module: "ebay-oauth" });

  const backToSettings = (c: Context<AppEnv>, outcome: { connected: true } | { error: ConnectErrorCode }) =>
    c.redirect(
      "connected" in outcome ? `${EBAY_SETTINGS_PATH}?connected=1` : `${EBAY_SETTINGS_PATH}?error=${outcome.error}`,
      302,
    );

  /**
   * connect/callback are browser navigations, so they're excluded from the JSON auth guard
   * and resolve the session here: an expired session leads back to login, not to a JSON 401.
   */
  async function sessionFor(c: Context<AppEnv>) {
    const token = readSessionCookie(c, deps.config);
    return token ? auth.authenticate(token) : null;
  }
  const toLogin = (c: Context<AppEnv>) =>
    c.redirect(`/login?next=${encodeURIComponent(`${EBAY_SETTINGS_PATH}?error=session_expired`)}`, 302);

  router.openapi(statusRoute, async (c) => c.json({ data: await ebay.getStatus() }, 200));

  router.openapi(connectRoute, async (c) => {
    const session = await sessionFor(c);
    if (!session) return toLogin(c);
    // These two routes bypass the JSON guard (and with it the demo restrictions), so the
    // rule "only the administrator connects eBay" is enforced here as well.
    if (session.admin.role !== "ADMIN") return backToSettings(c, { error: "demo" });
    try {
      return c.redirect(await ebay.startConnect(session.sessionId), 302);
    } catch (error) {
      if (error instanceof EbayNotConfiguredError) return backToSettings(c, { error: "not_configured" });
      throw error;
    }
  });

  router.openapi(callbackRoute, async (c) => {
    const session = await sessionFor(c);
    if (!session) return toLogin(c);
    if (session.admin.role !== "ADMIN") return backToSettings(c, { error: "demo" });

    const { code, state, error } = c.req.valid("query");
    if (!code || !state) {
      // eBay sends the browser to the decline URL without a code (exact parameters unconfirmed).
      log.info("eBay consent not granted", { ebayError: error ?? null });
      return backToSettings(c, { error: "declined" });
    }

    try {
      await ebay.completeConnect({ adminSessionId: session.sessionId, state, code });
      return backToSettings(c, { connected: true });
    } catch (err) {
      const errorCode: ConnectErrorCode =
        err instanceof InvalidOAuthStateError
          ? "invalid_state"
          : err instanceof EbayNotConfiguredError
            ? "not_configured"
            : err instanceof EbayUnavailableError
              ? "ebay_unavailable"
              : err instanceof EbayAuthorizationError || err instanceof EbayRequestError
                ? "ebay_rejected"
                : "unexpected";
      // Never log the code or state values.
      log[errorCode === "unexpected" ? "error" : "warn"]("eBay connect failed", {
        errorCode,
        error: err instanceof Error ? err.message : String(err),
      });
      return backToSettings(c, { error: errorCode });
    }
  });

  router.openapi(disconnectRoute, async (c) => {
    await ebay.disconnect();
    return c.json({ data: await ebay.getStatus() }, 200);
  });

  return router;
}
