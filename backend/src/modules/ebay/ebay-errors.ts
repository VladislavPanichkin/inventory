/**
 * Typed eBay integration failures. Messages never contain tokens, codes or secrets.
 */

/** eBay credentials (client ID/secret/RuName/encryption key) are not configured. */
export class EbayNotConfiguredError extends Error {
  constructor() {
    super("eBay API credentials are not configured on the server");
    this.name = "EbayNotConfiguredError";
  }
}

/** No usable eBay authorization: never connected, disconnected, or reconnect required. */
export class EbayNotConnectedError extends Error {
  constructor(message = "No eBay account is connected") {
    super(message);
    this.name = "EbayNotConnectedError";
  }
}

/**
 * eBay refused the grant: the refresh token was revoked/expired or the authorization
 * code is invalid/expired. Detected via the OAuth 2.0 standard `invalid_grant` error
 * (RFC 6749 §5.2). The admin must reconnect.
 */
export class EbayAuthorizationError extends Error {
  constructor(message = "eBay authorization is no longer valid") {
    super(message);
    this.name = "EbayAuthorizationError";
  }
}

/** Temporary problem (network error, timeout, HTTP 429/5xx). Safe to retry later. */
export class EbayUnavailableError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "EbayUnavailableError";
  }
}

/** eBay rejected the request for another reason (non-retryable), or answered unexpectedly. */
export class EbayRequestError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly ebayError?: string,
  ) {
    super(message);
    this.name = "EbayRequestError";
  }
}

export const isRetryableEbayError = (error: unknown) => error instanceof EbayUnavailableError;
