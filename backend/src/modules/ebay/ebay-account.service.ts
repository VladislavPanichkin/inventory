import { isEbayConfigured } from "../../config/env.js";
import { nowFrom, type AppDeps } from "../../common/router.js";
import { EbayConnectionStatus } from "../../generated/prisma/enums.js";
import { createTokenCipher, TokenCipherError, type TokenCipher } from "../../infrastructure/token-cipher.js";
import { EbayAuthorizationError, EbayNotConfiguredError, EbayNotConnectedError } from "./ebay-errors.js";
import { createEbayOAuthClient, type EbayOAuthClient } from "./ebay-oauth.client.js";

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
/** Refresh the access token this long before eBay's stated expiry. */
export const ACCESS_TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

export type ConnectionStatus = "NOT_CONNECTED" | `${EbayConnectionStatus}`;

export interface EbayConnectionStatusDto {
  configured: boolean;
  environment: "sandbox" | "production";
  connectionStatus: ConnectionStatus;
  sellerUsername: string | null;
  marketplaceId: string;
  connectedAt: string | null;
  refreshTokenExpiresAt: string | null;
  scopes: string[];
  lastErrorMessage: string | null;
}

/** The OAuth `state` was missing, unknown, expired, already used, or from another session. */
export class InvalidOAuthStateError extends Error {
  constructor() {
    super("The eBay authorization response could not be verified");
    this.name = "InvalidOAuthStateError";
  }
}

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export interface EbayAccountServiceOverrides {
  oauth?: EbayOAuthClient;
  cipher?: TokenCipher;
}

/**
 * Owns the single connected eBay seller account: OAuth connect/callback, encrypted token
 * storage, automatic access-token refresh, revocation detection and disconnect.
 * Tokens never leave this service except as the return value of `getAccessToken()`,
 * which is for server-side eBay API calls only.
 */
export function createEbayAccountService(deps: AppDeps, overrides: EbayAccountServiceOverrides = {}) {
  const { db, config, logger } = deps;
  const log = logger.child({ module: "ebay-account" });
  const oauth =
    overrides.oauth ??
    createEbayOAuthClient({ config, ...(deps.fetch ? { fetch: deps.fetch } : {}), now: () => nowFrom(deps) });

  let cipherInstance: TokenCipher | undefined = overrides.cipher;
  const cipher = (): TokenCipher => {
    if (cipherInstance) return cipherInstance;
    if (!config.TOKEN_ENCRYPTION_KEY) throw new EbayNotConfiguredError();
    cipherInstance = createTokenCipher(config.TOKEN_ENCRYPTION_KEY);
    return cipherInstance;
  };

  const findAccount = () => db.ebayAccount.findFirst({ orderBy: { createdAt: "asc" } });

  async function markReauthRequired(accountId: string, message: string) {
    await db.ebayAccount.update({
      where: { id: accountId },
      data: {
        connectionStatus: EbayConnectionStatus.REAUTH_REQUIRED,
        accessTokenEncrypted: null,
        accessTokenExpiresAt: null,
        lastErrorMessage: message,
      },
    });
    log.warn("eBay authorization requires reconnect", { accountId, reason: message });
  }

  // Single-flight: concurrent callers share one refresh request.
  let refreshInFlight: Promise<string> | null = null;

  async function refreshAccessToken(): Promise<string> {
    const account = await findAccount();
    if (!account || account.connectionStatus !== EbayConnectionStatus.CONNECTED || !account.refreshTokenEncrypted) {
      throw new EbayNotConnectedError();
    }

    let refreshToken: string;
    try {
      refreshToken = await cipher().decrypt(account.refreshTokenEncrypted);
    } catch (error) {
      if (error instanceof TokenCipherError) {
        await markReauthRequired(
          account.id,
          "Stored eBay credentials could not be decrypted (was TOKEN_ENCRYPTION_KEY changed?). Reconnect eBay.",
        );
        throw new EbayNotConnectedError("eBay must be reconnected");
      }
      throw error;
    }

    try {
      const refreshed = await oauth.refreshAccessToken(refreshToken);
      await db.ebayAccount.update({
        where: { id: account.id },
        data: {
          accessTokenEncrypted: await cipher().encrypt(refreshed.accessToken),
          accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
          ...(refreshed.refreshToken && { refreshTokenEncrypted: await cipher().encrypt(refreshed.refreshToken) }),
          ...(refreshed.refreshTokenExpiresAt && { refreshTokenExpiresAt: refreshed.refreshTokenExpiresAt }),
          lastErrorMessage: null,
        },
      });
      log.info("eBay access token refreshed", { accountId: account.id });
      return refreshed.accessToken;
    } catch (error) {
      if (error instanceof EbayAuthorizationError) {
        await markReauthRequired(account.id, "eBay authorization was revoked or has expired. Reconnect eBay.");
      }
      throw error;
    }
  }

  return {
    isConfigured: () => isEbayConfigured(config),

    async getStatus(): Promise<EbayConnectionStatusDto> {
      const account = await findAccount();
      return {
        configured: isEbayConfigured(config),
        environment: config.EBAY_ENVIRONMENT,
        connectionStatus: account?.connectionStatus ?? "NOT_CONNECTED",
        sellerUsername: account?.sellerUsername ?? null,
        marketplaceId: account?.marketplaceId ?? config.EBAY_MARKETPLACE_ID,
        connectedAt: account?.connectedAt?.toISOString() ?? null,
        refreshTokenExpiresAt: account?.refreshTokenExpiresAt?.toISOString() ?? null,
        scopes: account?.scopes ? account.scopes.split(" ").filter(Boolean) : [],
        lastErrorMessage: account?.lastErrorMessage ?? null,
      };
    },

    /** Step 1: create a single-use state bound to the admin's session; return eBay's consent URL. */
    async startConnect(adminSessionId: string): Promise<string> {
      if (!isEbayConfigured(config)) throw new EbayNotConfiguredError();
      const now = nowFrom(deps);
      const state = randomState();
      await db.$transaction([
        db.oAuthState.deleteMany({ where: { expiresAt: { lte: now } } }),
        db.oAuthState.create({
          data: { state, adminSessionId, expiresAt: new Date(now.getTime() + OAUTH_STATE_TTL_MS), createdAt: now },
        }),
      ]);
      return oauth.authorizationUrl(state);
    },

    /** Step 2 (callback): verify + consume the state, exchange the code, store tokens encrypted. */
    async completeConnect(input: { adminSessionId: string; state: string; code: string }) {
      if (!isEbayConfigured(config)) throw new EbayNotConfiguredError();
      const now = nowFrom(deps);

      // Atomic compare-and-set: the state can be consumed exactly once, only by its own session.
      const consumed = await db.oAuthState.updateMany({
        where: { state: input.state, adminSessionId: input.adminSessionId, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (consumed.count !== 1) throw new InvalidOAuthStateError();

      const tokens = await oauth.exchangeCode(input.code);
      const data = {
        connectionStatus: EbayConnectionStatus.CONNECTED,
        marketplaceId: config.EBAY_MARKETPLACE_ID,
        refreshTokenEncrypted: await cipher().encrypt(tokens.refreshToken),
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
        accessTokenEncrypted: await cipher().encrypt(tokens.accessToken),
        accessTokenExpiresAt: tokens.accessTokenExpiresAt,
        scopes: config.EBAY_SCOPES.join(" "),
        lastErrorMessage: null,
        connectedAt: now,
      };

      const existing = await findAccount();
      const account = existing
        ? await db.ebayAccount.update({ where: { id: existing.id }, data })
        : await db.ebayAccount.create({ data });
      log.info("eBay account connected", { accountId: account.id, environment: config.EBAY_ENVIRONMENT });
      return account.id;
    },

    /**
     * Valid access token for server-side eBay API calls (never send it to the browser).
     * Uses the cached token until shortly before expiry, then refreshes.
     */
    async getAccessToken(): Promise<string> {
      const account = await findAccount();
      if (!account || account.connectionStatus !== EbayConnectionStatus.CONNECTED) {
        throw new EbayNotConnectedError();
      }
      const now = nowFrom(deps).getTime();
      if (
        account.accessTokenEncrypted &&
        account.accessTokenExpiresAt &&
        account.accessTokenExpiresAt.getTime() - ACCESS_TOKEN_REFRESH_MARGIN_MS > now
      ) {
        try {
          return await cipher().decrypt(account.accessTokenEncrypted);
        } catch (error) {
          if (!(error instanceof TokenCipherError)) throw error;
          // Fall through to a refresh, which reports an undecryptable refresh token properly.
        }
      }
      refreshInFlight ??= refreshAccessToken().finally(() => {
        refreshInFlight = null;
      });
      return refreshInFlight;
    },

    /**
     * Forget the stored authorization. eBay offers no confirmed API to revoke a user token,
     * so the seller can additionally remove the app's access in their eBay account settings.
     * Listing mappings, sales and history are kept.
     */
    async disconnect() {
      const account = await findAccount();
      if (!account) return;
      await db.$transaction([
        db.ebayAccount.update({
          where: { id: account.id },
          data: {
            connectionStatus: EbayConnectionStatus.DISCONNECTED,
            refreshTokenEncrypted: null,
            refreshTokenExpiresAt: null,
            accessTokenEncrypted: null,
            accessTokenExpiresAt: null,
            lastErrorMessage: null,
            connectedAt: null,
          },
        }),
        db.oAuthState.deleteMany({}),
      ]);
      log.info("eBay account disconnected", { accountId: account.id });
    },
  };
}

export type EbayAccountService = ReturnType<typeof createEbayAccountService>;
