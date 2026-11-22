import { z } from "zod";
import type { AppConfig } from "../../config/env.js";
import { withRetry } from "../../common/retry.js";
import {
  EbayAuthorizationError,
  EbayNotConfiguredError,
  EbayRequestError,
  EbayUnavailableError,
  isRetryableEbayError,
} from "./ebay-errors.js";

/**
 * eBay OAuth 2.0 authorization-code grant: consent URL, code exchange, token refresh.
 *
 * Verified against eBay's official OAuth client sources (github.com/eBay/ebay-oauth-*-client):
 * endpoints, POST + application/x-www-form-urlencoded, Basic auth with client_id:client_secret,
 * body fields, token response field names. developer.ebay.com pages were not machine-readable
 * at the time of writing; see docs/architecture.md for what remains unconfirmed.
 */

export const EBAY_OAUTH_ENDPOINTS = {
  sandbox: {
    authorize: "https://auth.sandbox.ebay.com/oauth2/authorize",
    token: "https://api.sandbox.ebay.com/identity/v1/oauth2/token",
  },
  production: {
    authorize: "https://auth.ebay.com/oauth2/authorize",
    token: "https://api.ebay.com/identity/v1/oauth2/token",
  },
} as const;

const REQUEST_TIMEOUT_MS = 15_000;

const codeExchangeResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1),
  refresh_token_expires_in: z.number().int().positive(),
  token_type: z.string().optional(),
});

const refreshResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  // Not confirmed whether eBay rotates refresh tokens; accept one if present.
  refresh_token: z.string().min(1).optional(),
  refresh_token_expires_in: z.number().int().positive().optional(),
  token_type: z.string().optional(),
});

const errorResponseSchema = z.object({ error: z.string(), error_description: z.string().optional() });

export interface TokenSet {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

export interface RefreshedAccessToken {
  accessToken: string;
  accessTokenExpiresAt: Date;
  /** Present only if eBay issued a new refresh token. */
  refreshToken?: string;
  refreshTokenExpiresAt?: Date;
}

export interface EbayOAuthClient {
  authorizationUrl(state: string): string;
  exchangeCode(code: string): Promise<TokenSet>;
  refreshAccessToken(refreshToken: string): Promise<RefreshedAccessToken>;
}

export interface EbayOAuthClientOptions {
  config: AppConfig;
  fetch?: typeof fetch;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export function createEbayOAuthClient(options: EbayOAuthClientOptions): EbayOAuthClient {
  const { config } = options;
  const http = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const endpoints = EBAY_OAUTH_ENDPOINTS[config.EBAY_ENVIRONMENT];

  function credentials() {
    const { EBAY_CLIENT_ID: clientId, EBAY_CLIENT_SECRET: clientSecret, EBAY_RU_NAME: ruName } = config;
    if (!clientId || !clientSecret || !ruName) throw new EbayNotConfiguredError();
    return { clientId, clientSecret, ruName };
  }

  async function postToken(form: Record<string, string>): Promise<unknown> {
    const { clientId, clientSecret } = credentials();
    let response: Response;
    try {
      response = await http(endpoints.token, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        },
        body: new URLSearchParams(form).toString(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const reason = error instanceof Error && error.name === "TimeoutError" ? "timed out" : "network error";
      throw new EbayUnavailableError(`eBay token endpoint unreachable (${reason})`);
    }

    const body: unknown = await response.json().catch(() => undefined);
    if (response.ok) return body;

    const parsedError = errorResponseSchema.safeParse(body);
    const ebayError = parsedError.success ? parsedError.data.error : undefined;
    if (response.status === 429 || response.status >= 500) {
      throw new EbayUnavailableError(`eBay token endpoint returned HTTP ${response.status}`, response.status);
    }
    if (ebayError === "invalid_grant") {
      throw new EbayAuthorizationError();
    }
    throw new EbayRequestError(
      `eBay rejected the token request (HTTP ${response.status}${ebayError ? `, ${ebayError}` : ""})`,
      response.status,
      ebayError,
    );
  }

  const retrying = <T>(operation: () => Promise<T>) =>
    withRetry(operation, {
      retries: 2,
      baseDelayMs: 500,
      isRetryable: isRetryableEbayError,
      ...(options.sleep ? { sleep: options.sleep } : {}),
    });

  const expiresAt = (seconds: number) => new Date(now().getTime() + seconds * 1000);

  return {
    authorizationUrl(state) {
      const { clientId, ruName } = credentials();
      const params = new URLSearchParams({
        client_id: clientId,
        // eBay expects the RuName (redirect URL *name* from the developer portal), not a URL.
        redirect_uri: ruName,
        response_type: "code",
        scope: config.EBAY_SCOPES.join(" "),
        state,
        // Always show eBay's login, so the admin consciously picks the seller account.
        prompt: "login",
      });
      return `${endpoints.authorize}?${params.toString()}`;
    },

    async exchangeCode(code) {
      // Not retried: an authorization code is single-use, a retry after a lost response would fail anyway.
      const body = await postToken({ grant_type: "authorization_code", code, redirect_uri: credentials().ruName });
      const parsed = codeExchangeResponseSchema.safeParse(body);
      if (!parsed.success) throw new EbayRequestError("Unexpected token response from eBay");
      return {
        accessToken: parsed.data.access_token,
        accessTokenExpiresAt: expiresAt(parsed.data.expires_in),
        refreshToken: parsed.data.refresh_token,
        refreshTokenExpiresAt: expiresAt(parsed.data.refresh_token_expires_in),
      };
    },

    async refreshAccessToken(refreshToken) {
      const body = await retrying(() =>
        postToken({ grant_type: "refresh_token", refresh_token: refreshToken, scope: config.EBAY_SCOPES.join(" ") }),
      );
      const parsed = refreshResponseSchema.safeParse(body);
      if (!parsed.success) throw new EbayRequestError("Unexpected token response from eBay");
      return {
        accessToken: parsed.data.access_token,
        accessTokenExpiresAt: expiresAt(parsed.data.expires_in),
        ...(parsed.data.refresh_token && { refreshToken: parsed.data.refresh_token }),
        ...(parsed.data.refresh_token_expires_in && {
          refreshTokenExpiresAt: expiresAt(parsed.data.refresh_token_expires_in),
        }),
      };
    },
  };
}
