import { describe, expect, it } from "vitest";
import { EbayAuthorizationError, EbayRequestError, EbayUnavailableError } from "../../src/modules/ebay/ebay-errors.js";
import { createEbayTradingClient } from "../../src/modules/ebay/ebay-trading.client.js";
import { activeListResponse, createFakeEbay, serverError, tradingFailure } from "../support/fake-ebay.js";

function setup(config: { EBAY_ENVIRONMENT?: "sandbox" | "production"; EBAY_MARKETPLACE_ID?: string } = {}) {
  const ebay = createFakeEbay();
  const client = createEbayTradingClient({
    config: { EBAY_ENVIRONMENT: "production", EBAY_MARKETPLACE_ID: "EBAY_DE", ...config },
    fetch: ebay.fetch,
    sleep: async () => {},
  });
  return { ebay, client };
}

describe("getActiveListings request", () => {
  it("calls GetMyeBaySelling on the production Trading API with the OAuth token header", async () => {
    const { ebay, client } = setup();
    ebay.respond(activeListResponse([]));
    await client.getActiveListings("user-access-token");

    const [request] = ebay.requests;
    expect(request!.url).toBe("https://api.ebay.com/ws/api.dll");
    expect(request!.method).toBe("POST");
    expect(request!.headers).toMatchObject({
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": "GetMyeBaySelling",
      "X-EBAY-API-SITEID": "77",
      "X-EBAY-API-IAF-TOKEN": "user-access-token",
    });
    expect(request!.headers["X-EBAY-API-COMPATIBILITY-LEVEL"]).toMatch(/^\d+$/);
    expect(request!.body).toContain('<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">');
    expect(request!.body).toContain("<ActiveList><Include>true</Include>");
    expect(request!.body).toContain("<EntriesPerPage>200</EntriesPerPage><PageNumber>1</PageNumber>");
    // The token belongs in the header only.
    expect(request!.body).not.toContain("user-access-token");
  });

  it("uses the sandbox endpoint and falls back to site 0 for an unknown marketplace", async () => {
    const { ebay, client } = setup({ EBAY_ENVIRONMENT: "sandbox", EBAY_MARKETPLACE_ID: "EBAY_XX" });
    ebay.respond(activeListResponse([]));
    await client.getActiveListings("t");
    expect(ebay.requests[0]!.url).toBe("https://api.sandbox.ebay.com/ws/api.dll");
    expect(ebay.requests[0]!.headers["X-EBAY-API-SITEID"]).toBe("0");
  });
});

describe("getActiveListings answer", () => {
  it("maps items and normalizes prices and addresses", async () => {
    const { ebay, client } = setup();
    ebay.respond(
      activeListResponse([
        { itemId: "125000000001", title: "Vintage lamp & shade", price: "149.9", image: "http://i.ebayimg.com/a.jpg" },
        { itemId: "125000000002", title: null, price: null, url: null, image: null, quantity: 3 },
        { itemId: "125000000003", price: "20", currency: "USD", url: "javascript:alert(1)" },
      ]),
    );

    expect(await client.getActiveListings("t")).toEqual([
      {
        itemId: "125000000001",
        title: "Vintage lamp & shade",
        price: "149.90",
        currency: "EUR",
        listingUrl: "https://www.ebay.de/itm/125000000001",
        imageUrl: "https://i.ebayimg.com/a.jpg",
        quantityAvailable: 1,
        listingType: "FixedPriceItem",
      },
      {
        itemId: "125000000002",
        title: null,
        price: null,
        currency: null,
        listingUrl: null,
        imageUrl: null,
        quantityAvailable: 3,
        listingType: "FixedPriceItem",
      },
      expect.objectContaining({ itemId: "125000000003", price: "20.00", currency: "USD", listingUrl: null }),
    ]);
  });

  it("returns an empty list when the seller has no active listings", async () => {
    const { ebay, client } = setup();
    ebay.respond(activeListResponse([]));
    expect(await client.getActiveListings("t")).toEqual([]);
  });

  it("ignores items without a usable item ID", async () => {
    const { ebay, client } = setup();
    ebay.respond(activeListResponse([{ itemId: "abc" }, { itemId: "125000000009" }]));
    expect((await client.getActiveListings("t")).map((listing) => listing.itemId)).toEqual(["125000000009"]);
  });

  it("follows pagination and removes duplicates", async () => {
    const { ebay, client } = setup();
    ebay.respond(
      activeListResponse([{ itemId: "125000000001" }, { itemId: "125000000002" }], 2),
      activeListResponse([{ itemId: "125000000002" }, { itemId: "125000000003" }], 2),
    );

    const listings = await client.getActiveListings("t");
    expect(listings.map((listing) => listing.itemId)).toEqual(["125000000001", "125000000002", "125000000003"]);
    expect(ebay.requests).toHaveLength(2);
    expect(ebay.requests[1]!.body).toContain("<PageNumber>2</PageNumber>");
  });
});

describe("getActiveListings failures", () => {
  it("reports a rejected token as an authorization error, without retrying", async () => {
    const { ebay, client } = setup();
    ebay.respond(tradingFailure("931", "Auth token is invalid."));
    await expect(client.getActiveListings("t")).rejects.toBeInstanceOf(EbayAuthorizationError);
    expect(ebay.requests).toHaveLength(1);
  });

  it("treats an error document on a 5xx status as the answer, not as an outage", async () => {
    const { ebay, client } = setup();
    ebay.respond(tradingFailure("21916984", "Invalid IAF token.", 500));
    await expect(client.getActiveListings("t")).rejects.toBeInstanceOf(EbayAuthorizationError);
    expect(ebay.requests).toHaveLength(1);
  });

  it("passes on eBay's own message for other failures", async () => {
    const { ebay, client } = setup();
    ebay.respond(tradingFailure("21919456", "Insufficient permissions <scope>."));
    const error = await client.getActiveListings("t").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EbayRequestError);
    expect((error as EbayRequestError).message).toBe(
      "eBay rejected the request (error 21919456): Insufficient permissions <scope>.",
    );
    expect((error as EbayRequestError).ebayError).toBe("21919456");
  });

  it("retries temporary outages and then succeeds", async () => {
    const { ebay, client } = setup();
    ebay.respond(serverError(503), { networkError: true }, activeListResponse([{ itemId: "125000000001" }]));
    expect(await client.getActiveListings("t")).toHaveLength(1);
    expect(ebay.requests).toHaveLength(3);
  });

  it("gives up after repeated outages", async () => {
    const { ebay, client } = setup();
    ebay.respond(serverError(503), serverError(502), serverError(429));
    await expect(client.getActiveListings("t")).rejects.toBeInstanceOf(EbayUnavailableError);
    expect(ebay.pending()).toBe(0);
  });

  it("rejects an answer that is not the expected document", async () => {
    const { ebay, client } = setup();
    ebay.respond({ status: 200, xml: "<html><body>Maintenance</body></html>" });
    await expect(client.getActiveListings("t")).rejects.toBeInstanceOf(EbayRequestError);

    ebay.respond({ status: 200, body: { not: "xml" } });
    await expect(client.getActiveListings("t")).rejects.toBeInstanceOf(EbayRequestError);
  });

  it("never puts the token into an error message", async () => {
    const { ebay, client } = setup();
    ebay.respond(tradingFailure("931", "Auth token is invalid."));
    const error = (await client.getActiveListings("secret-token-value").catch((e: unknown) => e)) as Error;
    expect(error.message).not.toContain("secret-token-value");
  });
});
