import { createRoute, z } from "@hono/zod-openapi";
import { API_PREFIX } from "../../common/api-prefix.js";
import { errorBody, errorResponseSchema } from "../../common/http.js";
import { createRouter, type AppDeps } from "../../common/router.js";
import type { AppConfig } from "../../config/env.js";

/**
 * eBay "Marketplace account deletion" endpoint.
 *
 * eBay keeps a production keyset disabled until the application either subscribes to these
 * notices or declares an exemption. This app stores nothing about other eBay users (no buyer
 * names, addresses or user IDs), so there is never anything to delete: a notice is
 * acknowledged and dropped. Because no action follows from a notice, its signature is not
 * verified and its body is neither read nor stored. If buyer data is ever stored, this
 * handler must verify `X-EBAY-SIGNATURE` and delete that user's data.
 *
 * Protocol taken from eBay's official SDK (github.com/eBay/event-notification-nodejs-sdk):
 *  - GET  ?challenge_code=…  → 200 { challengeResponse: hex(sha256(code + token + endpoint)) }
 *  - POST notification       → 204
 */
export const ACCOUNT_DELETION_PATH = "/webhooks/ebay/account-deletion";

/** The public address to enter in eBay's developer portal. Must match it character for character. */
export function accountDeletionEndpointUrl(config: Pick<AppConfig, "FRONTEND_URL">): string {
  return new URL(`${API_PREFIX}${ACCOUNT_DELETION_PATH}`, config.FRONTEND_URL).toString();
}

/** SHA-256 over challenge code, verification token and endpoint URL (in that order, no separators), hex. */
export async function computeChallengeResponse(
  challengeCode: string,
  verificationToken: string,
  endpointUrl: string,
): Promise<string> {
  const input = new TextEncoder().encode(challengeCode + verificationToken + endpointUrl);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const tags = ["eBay integration"];
const notEnabled = { description: "Endpoint not enabled", content: { "application/json": { schema: errorResponseSchema } } };

const challengeRoute = createRoute({
  method: "get",
  path: ACCOUNT_DELETION_PATH,
  tags,
  summary: "eBay endpoint validation for marketplace account deletion notices",
  description: "Called by eBay, not by the frontend. Enabled only when EBAY_VERIFICATION_TOKEN is set.",
  request: { query: z.object({ challenge_code: z.string().min(1).max(256) }) },
  responses: {
    200: {
      description: "Challenge response",
      content: { "application/json": { schema: z.object({ challengeResponse: z.string() }) } },
    },
    404: notEnabled,
  },
});

const noticeRoute = createRoute({
  method: "post",
  path: ACCOUNT_DELETION_PATH,
  tags,
  summary: "Receives marketplace account deletion notices (acknowledged, nothing stored)",
  description: "Called by eBay, not by the frontend. Enabled only when EBAY_VERIFICATION_TOKEN is set.",
  responses: { 204: { description: "Acknowledged" }, 404: notEnabled },
});

export function createEbayAccountDeletionRoutes(deps: AppDeps) {
  const router = createRouter();
  const log = deps.logger.child({ module: "ebay-account-deletion" });
  const token = deps.config.EBAY_VERIFICATION_TOKEN;
  const endpointUrl = accountDeletionEndpointUrl(deps.config);

  router.openapi(challengeRoute, async (c) => {
    if (!token) return c.json(errorBody("NOT_FOUND", "Not found", undefined, c.get("requestId")), 404);
    const { challenge_code: challengeCode } = c.req.valid("query");
    log.info("eBay endpoint validation answered");
    return c.json({ challengeResponse: await computeChallengeResponse(challengeCode, token, endpointUrl) }, 200);
  });

  router.openapi(noticeRoute, (c) => {
    if (!token) return c.json(errorBody("NOT_FOUND", "Not found", undefined, c.get("requestId")), 404);
    // Deliberately does not read the body: it names an eBay user the app holds no data about.
    return c.body(null, 204);
  });

  return router;
}
