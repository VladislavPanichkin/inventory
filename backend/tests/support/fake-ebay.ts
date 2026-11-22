/**
 * Stand-in for eBay (OAuth token endpoint and Trading API). Records every request and answers
 * from a queue of scripted responses, so tests exercise real HTTP handling without the network.
 */

export const TEST_EBAY_ENV = {
  EBAY_ENVIRONMENT: "sandbox",
  EBAY_CLIENT_ID: "test-client-id",
  EBAY_CLIENT_SECRET: "test-client-secret",
  EBAY_RU_NAME: "Test_Seller-TestApp-SBX-abcdef",
  EBAY_MARKETPLACE_ID: "EBAY_DE",
  // 32 bytes, base64. Test-only key.
  TOKEN_ENCRYPTION_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
} as const;

export interface RecordedEbayRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  form: URLSearchParams;
  /** The raw request body (the Trading API sends XML). */
  body: string;
}

export type ScriptedResponse =
  | { status: number; body?: unknown }
  | { status: number; xml: string }
  | { networkError: true };

export const tokenResponse = (overrides: Record<string, unknown> = {}): ScriptedResponse => ({
  status: 200,
  body: {
    access_token: "access-token-1",
    expires_in: 7200,
    refresh_token: "refresh-token-1",
    refresh_token_expires_in: 47_304_000,
    token_type: "User Access Token",
    ...overrides,
  },
});

export const refreshResponse = (accessToken = "access-token-2"): ScriptedResponse => ({
  status: 200,
  body: { access_token: accessToken, expires_in: 7200, token_type: "User Access Token" },
});

export const invalidGrant = (): ScriptedResponse => ({
  status: 400,
  body: { error: "invalid_grant", error_description: "the provided authorization grant is invalid" },
});

export const serverError = (status = 503): ScriptedResponse => ({ status, body: { error: "server_error" } });

/** One <Item> of a GetMyeBaySelling ActiveList. Pass `null` to leave an element out. */
export interface FakeListing {
  itemId: string;
  title?: string | null;
  price?: string | null;
  currency?: string;
  url?: string | null;
  image?: string | null;
  quantity?: number;
}

const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export function listingXml(listing: FakeListing): string {
  const title = listing.title === undefined ? `Item ${listing.itemId}` : listing.title;
  const price = listing.price === undefined ? "10.0" : listing.price;
  const url = listing.url === undefined ? `https://www.ebay.de/itm/${listing.itemId}` : listing.url;
  const image = listing.image === undefined ? `https://i.ebayimg.com/images/g/${listing.itemId}/s-l140.jpg` : listing.image;
  return [
    "<Item>",
    `<ItemID>${listing.itemId}</ItemID>`,
    title === null ? "" : `<Title>${escape(title)}</Title>`,
    url === null ? "" : `<ListingDetails><ViewItemURL>${escape(url)}</ViewItemURL></ListingDetails>`,
    price === null
      ? ""
      : `<SellingStatus><CurrentPrice currencyID="${listing.currency ?? "EUR"}">${price}</CurrentPrice></SellingStatus>`,
    image === null ? "" : `<PictureDetails><GalleryURL>${escape(image)}</GalleryURL></PictureDetails>`,
    `<Quantity>${listing.quantity ?? 1}</Quantity><QuantityAvailable>${listing.quantity ?? 1}</QuantityAvailable>`,
    "<ListingType>FixedPriceItem</ListingType>",
    "</Item>",
  ].join("");
}

/** A successful GetMyeBaySelling answer holding one page of the active list. */
export const activeListResponse = (listings: FakeListing[], totalPages = 1): ScriptedResponse => ({
  status: 200,
  xml: [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<GetMyeBaySellingResponse xmlns="urn:ebay:apis:eBLBaseComponents">',
    "<Timestamp>2026-03-01T10:00:00.000Z</Timestamp><Ack>Success</Ack><Version>1349</Version>",
    "<ActiveList>",
    listings.length > 0 ? `<ItemArray>${listings.map(listingXml).join("")}</ItemArray>` : "",
    `<PaginationResult><TotalNumberOfPages>${totalPages}</TotalNumberOfPages>`,
    `<TotalNumberOfEntries>${listings.length}</TotalNumberOfEntries></PaginationResult>`,
    "</ActiveList>",
    "</GetMyeBaySellingResponse>",
  ].join(""),
});

/** A Trading API failure answer (eBay reports these with an error document). */
export const tradingFailure = (code: string, shortMessage: string, status = 200): ScriptedResponse => ({
  status,
  xml: [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<GetMyeBaySellingResponse xmlns="urn:ebay:apis:eBLBaseComponents">',
    "<Ack>Failure</Ack>",
    `<Errors><ShortMessage>${escape(shortMessage)}</ShortMessage><LongMessage>${escape(shortMessage)} (long)</LongMessage>`,
    `<ErrorCode>${code}</ErrorCode><SeverityCode>Error</SeverityCode></Errors>`,
    "</GetMyeBaySellingResponse>",
  ].join(""),
});

export function createFakeEbay() {
  const requests: RecordedEbayRequest[] = [];
  const queue: ScriptedResponse[] = [];

  const fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    requests.push({
      url: String(input),
      method: init.method ?? "GET",
      headers: { ...((init.headers ?? {}) as Record<string, string>) },
      form: new URLSearchParams(typeof init.body === "string" ? init.body : ""),
      body: typeof init.body === "string" ? init.body : "",
    });
    const next = queue.shift();
    if (!next) throw new Error(`fake eBay: no scripted response for ${String(input)}`);
    if ("networkError" in next) throw new TypeError("fetch failed");
    if ("xml" in next) {
      return new Response(next.xml, { status: next.status, headers: { "Content-Type": "text/xml" } });
    }
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), {
      status: next.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof globalThis.fetch;

  return {
    fetch,
    requests,
    respond(...responses: ScriptedResponse[]) {
      queue.push(...responses);
    },
    pending: () => queue.length,
  };
}
