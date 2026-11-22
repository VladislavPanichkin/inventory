import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  activeListResponse,
  createFakeEbay,
  TEST_EBAY_ENV,
  tokenResponse,
  tradingFailure,
} from "../support/fake-ebay.js";
import { client, createTestApp, json, loginAsAdmin } from "./app-client.js";
import { createTestDatabase, resetDatabase } from "./helpers.js";

const db = createTestDatabase();
const LISTINGS = "/api/v1/integrations/ebay/listings";
const IMPORT = `${LISTINGS}/import`;

let ebay: ReturnType<typeof createFakeEbay>;

beforeEach(async () => {
  await resetDatabase(db);
  ebay = createFakeEbay();
});

afterAll(async () => {
  await db.$disconnect();
});

const setup = () => createTestApp(db, { fetch: ebay.fetch }, TEST_EBAY_ENV);

/** Logs in and connects an eBay account through the normal connect → callback flow. */
async function connected() {
  const app = setup();
  const { api } = await loginAsAdmin(db, app);
  const connect = await api.get("/api/v1/integrations/ebay/connect");
  const state = new URL(connect.headers.get("location")!).searchParams.get("state")!;
  ebay.respond(tokenResponse());
  await api.get(`/api/v1/integrations/ebay/callback?state=${encodeURIComponent(state)}&code=auth-code-1`);
  ebay.requests.length = 0;
  return { app, api };
}

const lamp = { itemId: "125000000001", title: "Vintage lamp", price: "149.9" };
const chair = { itemId: "125000000002", title: "Oak chair", price: "80.00" };

describe("GET eBay listings", () => {
  it("requires a session", async () => {
    expect((await client(setup()).get(LISTINGS)).status).toBe(401);
    expect((await client(setup()).post(IMPORT)).status).toBe(401);
  });

  it("explains that eBay must be connected first", async () => {
    const { api } = await loginAsAdmin(db, setup());
    const res = await api.get(LISTINGS);
    expect(res.status).toBe(409);
    expect((await json(res)).error.code).toBe("EBAY_NOT_CONNECTED");
    expect(ebay.requests).toHaveLength(0);
  });

  it("returns the seller's active listings using the stored token, marking imported ones", async () => {
    const { api } = await connected();
    ebay.respond(activeListResponse([lamp]));
    await api.post(IMPORT);

    ebay.respond(activeListResponse([lamp, chair]));
    const res = await api.get(LISTINGS);
    expect(res.status).toBe(200);
    const { data } = await json(res);

    expect(data).toHaveLength(2);
    expect(data[0]).toMatchObject({
      itemId: "125000000001",
      title: "Vintage lamp",
      price: "149.90",
      currency: "EUR",
      listingUrl: "https://www.ebay.de/itm/125000000001",
      quantityAvailable: 1,
    });
    expect(typeof data[0].productId).toBe("string");
    expect(data[1]).toMatchObject({ itemId: "125000000002", productId: null });
    expect(ebay.requests.at(-1)!.headers["X-EBAY-API-IAF-TOKEN"]).toBe("access-token-1");
    // The token never reaches the browser.
    expect(JSON.stringify(data)).not.toContain("access-token-1");
  });

  it("asks to reconnect when eBay no longer accepts the authorization", async () => {
    const { api } = await connected();
    ebay.respond(tradingFailure("931", "Auth token is invalid."));
    const res = await api.get(LISTINGS);
    expect(res.status).toBe(409);
    expect((await json(res)).error).toMatchObject({ code: "EBAY_REAUTH_REQUIRED" });
  });

  it("passes on eBay's reason when it rejects the request", async () => {
    const { api } = await connected();
    ebay.respond(tradingFailure("21919456", "Insufficient permissions."));
    const res = await api.get(LISTINGS);
    expect(res.status).toBe(502);
    expect((await json(res)).error).toMatchObject({
      code: "EBAY_REJECTED",
      message: "eBay rejected the request (error 21919456): Insufficient permissions.",
    });
  });
});

describe("POST eBay listings import", () => {
  it("creates one product per listing, linked to it, with history", async () => {
    const { api } = await connected();
    ebay.respond(activeListResponse([lamp, chair]));

    const res = await api.post(IMPORT);
    expect(res.status).toBe(200);
    const { data } = await json(res);
    expect(data.created.map((entry: { itemId: string }) => entry.itemId)).toEqual(["125000000001", "125000000002"]);
    expect(data.skipped).toEqual([]);

    const product = (await json(await api.get(`/api/v1/products/${data.created[0].productId}`))).data;
    expect(product).toMatchObject({
      name: "Vintage lamp",
      price: "149.90",
      currency: "EUR",
      status: "AVAILABLE",
      listing: {
        ebayItemId: "125000000001",
        marketplaceId: "EBAY_DE",
        title: "Vintage lamp",
        listingStatus: "ACTIVE",
        listingUrl: "https://www.ebay.de/itm/125000000001",
        imageUrl: "https://i.ebayimg.com/images/g/125000000001/s-l140.jpg",
      },
    });

    const history = (await json(await api.get(`/api/v1/products/${product.id}/status-history`))).data;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      toStatus: "AVAILABLE",
      source: "IMPORT",
      reason: "Imported from eBay listing 125000000001",
    });
  });

  it("is safe to repeat: already imported listings are skipped", async () => {
    const { api } = await connected();
    ebay.respond(activeListResponse([lamp]), activeListResponse([lamp, chair]));
    await api.post(IMPORT);

    const { data } = await json(await api.post(IMPORT));
    expect(data.created.map((entry: { itemId: string }) => entry.itemId)).toEqual(["125000000002"]);
    expect(data.skipped).toEqual([{ itemId: "125000000001", reason: "ALREADY_IMPORTED" }]);
    expect(await db.product.count()).toBe(2);
    expect(await db.ebayListing.count()).toBe(2);
  });

  it("imports only the requested items and takes their data from eBay", async () => {
    const { api } = await connected();
    ebay.respond(activeListResponse([lamp, chair, { itemId: "125000000003", price: null }]));

    const { data } = await json(
      await api.post(IMPORT, { itemIds: ["125000000002", "125000000003", "999999999999", "125000000002"] }),
    );
    expect(data.created.map((entry: { itemId: string }) => entry.itemId)).toEqual(["125000000002"]);
    expect(data.skipped).toEqual([
      { itemId: "125000000003", reason: "NO_PRICE" },
      { itemId: "999999999999", reason: "NOT_ACTIVE" },
    ]);
    expect((await db.product.findMany()).map((product) => product.name)).toEqual(["Oak chair"]);
  });

  it("uses a placeholder name for a listing without a title and trims very long titles", async () => {
    const { api } = await connected();
    ebay.respond(activeListResponse([{ itemId: "125000000004", title: null }, { itemId: "125000000005", title: "x".repeat(300) }]));
    await api.post(IMPORT);

    const names = (await db.product.findMany({ orderBy: { createdAt: "asc" } })).map((product) => product.name);
    expect(names[0]).toBe("eBay item 125000000004");
    expect(names[1]).toHaveLength(200);
  });

  it("rejects malformed item IDs", async () => {
    const { api } = await connected();
    const res = await api.post(IMPORT, { itemIds: ["not-an-id"] });
    expect(res.status).toBe(400);
    expect(ebay.requests).toHaveLength(0);
  });

  it("creates nothing when eBay fails", async () => {
    const { api } = await connected();
    ebay.respond(tradingFailure("10007", "Internal error to the application."));
    expect((await api.post(IMPORT)).status).toBe(502);
    expect(await db.product.count()).toBe(0);
  });
});
