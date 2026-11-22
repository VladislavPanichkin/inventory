import type { AppConfig } from "../../config/env.js";
import { withRetry } from "../../common/retry.js";
import { parseXml, xmlChild, xmlChildren, xmlText, XmlParseError, type XmlNode } from "../../common/xml.js";
import { EbayAuthorizationError, EbayRequestError, EbayUnavailableError, isRetryableEbayError } from "./ebay-errors.js";

/**
 * Read-only client for eBay's Trading API call `GetMyeBaySelling` (the seller's active listings).
 *
 * The Trading API is used because the newer Inventory API cannot see listings created on
 * ebay.de / in Seller Hub. It is XML over HTTPS; the OAuth user access token travels in the
 * `X-EBAY-API-IAF-TOKEN` header (see docs/architecture.md for what was confirmed and when).
 *
 * This client only ever reads. It has not yet been run against eBay itself: the response
 * handling is deliberately tolerant (every field except ItemID is optional).
 */

export const EBAY_TRADING_ENDPOINTS = {
  sandbox: "https://api.sandbox.ebay.com/ws/api.dll",
  production: "https://api.ebay.com/ws/api.dll",
} as const;

/** Trading API schema version this client was written for. */
export const TRADING_COMPATIBILITY_LEVEL = "1349";

/** Trading "site IDs" for the marketplaces this app may be configured for. Unknown → 0 (US). */
export const TRADING_SITE_IDS: Record<string, number> = {
  EBAY_US: 0,
  EBAY_CA: 2,
  EBAY_GB: 3,
  EBAY_AU: 15,
  EBAY_AT: 16,
  EBAY_FR: 71,
  EBAY_DE: 77,
  EBAY_IT: 101,
  EBAY_NL: 146,
  EBAY_ES: 186,
  EBAY_CH: 193,
  EBAY_IE: 205,
  EBAY_PL: 212,
};

/** Trading error codes that mean "the token is not accepted" (invalid, expired, revoked). */
const AUTH_ERROR_CODES = new Set(["931", "932", "16110", "17470", "21916984", "21917053"]);

const REQUEST_TIMEOUT_MS = 20_000;
const ENTRIES_PER_PAGE = 200;
/** Safety stop: 50 pages × 200 = 10,000 listings. */
const MAX_PAGES = 50;

export interface EbayActiveListing {
  itemId: string;
  title: string | null;
  /** Decimal string with 2 decimals, e.g. "149.90". Null if eBay sent no usable price. */
  price: string | null;
  currency: string | null;
  /** The listing's address exactly as eBay reports it (never constructed here). */
  listingUrl: string | null;
  imageUrl: string | null;
  /** Units still available. This app tracks unique items, so anything above 1 is unusual. */
  quantityAvailable: number | null;
  listingType: string | null;
}

export interface EbayTradingClient {
  /** All active listings of the seller the token belongs to. */
  getActiveListings(accessToken: string): Promise<EbayActiveListing[]>;
}

export interface EbayTradingClientOptions {
  config: Pick<AppConfig, "EBAY_ENVIRONMENT" | "EBAY_MARKETPLACE_ID">;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

function activeListRequest(pageNumber: number): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">',
    "<ErrorLanguage>en_US</ErrorLanguage>",
    "<ActiveList>",
    "<Include>true</Include>",
    `<Pagination><EntriesPerPage>${ENTRIES_PER_PAGE}</EntriesPerPage><PageNumber>${pageNumber}</PageNumber></Pagination>`,
    "</ActiveList>",
    "</GetMyeBaySellingRequest>",
  ].join("");
}

/** "149.9" → "149.90". Null for anything that is not a plain non-negative amount. */
function normalizePrice(raw: string | undefined): string | null {
  if (!raw || !/^\d{1,10}(\.\d+)?$/.test(raw)) return null;
  const [whole, fraction = ""] = raw.split(".");
  // eBay prices have at most 2 decimals; extra digits are dropped, never rounded up.
  return `${whole}.${fraction.padEnd(2, "0").slice(0, 2)}`;
}

function httpsUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol === "http:") url.protocol = "https:";
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function toListing(item: XmlNode): EbayActiveListing | null {
  const itemId = xmlText(item, "ItemID");
  if (!itemId || !/^\d{6,20}$/.test(itemId)) return null;

  const priceNode =
    xmlChild(item, "SellingStatus", "CurrentPrice") ?? xmlChild(item, "BuyItNowPrice") ?? xmlChild(item, "StartPrice");
  const currency = priceNode?.attributes.currencyID;
  const quantity = Number(xmlText(item, "QuantityAvailable") ?? xmlText(item, "Quantity"));

  return {
    itemId,
    title: xmlText(item, "Title") ?? null,
    price: normalizePrice(priceNode?.text.trim()),
    currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : null,
    listingUrl: httpsUrl(xmlText(item, "ListingDetails", "ViewItemURL")),
    imageUrl: httpsUrl(xmlText(item, "PictureDetails", "GalleryURL")),
    quantityAvailable: Number.isInteger(quantity) && quantity >= 0 ? quantity : null,
    listingType: xmlText(item, "ListingType") ?? null,
  };
}

/** Turns a `Failure` answer into a typed error. eBay's message is shown to the admin, shortened. */
function failureFrom(root: XmlNode): Error {
  const errors = xmlChildren(root, "Errors");
  const error = errors.find((entry) => xmlText(entry, "SeverityCode") !== "Warning") ?? errors[0];
  const code = xmlText(error, "ErrorCode");
  const message = (xmlText(error, "ShortMessage") ?? "no details given").slice(0, 200);
  if (code && AUTH_ERROR_CODES.has(code)) {
    return new EbayAuthorizationError(`eBay did not accept the stored authorization (error ${code})`);
  }
  return new EbayRequestError(`eBay rejected the request${code ? ` (error ${code})` : ""}: ${message}`, undefined, code);
}

export function createEbayTradingClient(options: EbayTradingClientOptions): EbayTradingClient {
  const http = options.fetch ?? fetch;
  const endpoint = EBAY_TRADING_ENDPOINTS[options.config.EBAY_ENVIRONMENT];
  const siteId = TRADING_SITE_IDS[options.config.EBAY_MARKETPLACE_ID] ?? 0;

  async function requestPage(accessToken: string, pageNumber: number): Promise<XmlNode> {
    let response: Response;
    try {
      response = await http(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "text/xml",
          "X-EBAY-API-CALL-NAME": "GetMyeBaySelling",
          "X-EBAY-API-SITEID": String(siteId),
          "X-EBAY-API-COMPATIBILITY-LEVEL": TRADING_COMPATIBILITY_LEVEL,
          "X-EBAY-API-IAF-TOKEN": accessToken,
        },
        body: activeListRequest(pageNumber),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const reason = error instanceof Error && error.name === "TimeoutError" ? "timed out" : "network error";
      throw new EbayUnavailableError(`eBay listings request failed (${reason})`);
    }

    const temporary = response.status === 429 || response.status >= 500;
    const unavailable = () => new EbayUnavailableError(`eBay returned HTTP ${response.status}`, response.status);
    const text = await response.text().catch(() => "");

    let root: XmlNode;
    try {
      root = parseXml(text);
    } catch (error) {
      if (!(error instanceof XmlParseError)) throw error;
      if (temporary) throw unavailable();
      throw new EbayRequestError(`Unexpected answer from eBay (HTTP ${response.status})`, response.status);
    }

    // An explicit failure answer wins over the HTTP status: eBay may report a rejected
    // token with an error document on a 5xx status, and retrying that would be pointless.
    const ack = xmlText(root, "Ack");
    if (ack === "Failure" || ack === "PartialFailure") throw failureFrom(root);
    if (temporary) throw unavailable();
    if (root.name !== "GetMyeBaySellingResponse" || !ack) {
      throw new EbayRequestError(`Unexpected answer from eBay (HTTP ${response.status})`, response.status);
    }
    return root;
  }

  const retrying = <T>(operation: () => Promise<T>) =>
    withRetry(operation, {
      retries: 2,
      baseDelayMs: 500,
      isRetryable: isRetryableEbayError,
      ...(options.sleep ? { sleep: options.sleep } : {}),
    });

  return {
    async getActiveListings(accessToken) {
      const byItemId = new Map<string, EbayActiveListing>();

      for (let page = 1; page <= MAX_PAGES; page++) {
        const root = await retrying(() => requestPage(accessToken, page));
        const activeList = xmlChild(root, "ActiveList");
        for (const item of xmlChildren(xmlChild(activeList, "ItemArray"), "Item")) {
          const listing = toListing(item);
          if (listing) byItemId.set(listing.itemId, listing);
        }
        const totalPages = Number(xmlText(activeList, "PaginationResult", "TotalNumberOfPages") ?? "1");
        if (!Number.isInteger(totalPages) || page >= totalPages) break;
      }
      return [...byItemId.values()];
    },
  };
}
