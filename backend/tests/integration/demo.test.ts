import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "../../src/common/logger.js";
import type { AppDeps } from "../../src/common/router.js";
import { loadConfig } from "../../src/config/env.js";
import { Prisma } from "../../src/generated/prisma/client.js";
import { createMemoryImageStorage } from "../../src/infrastructure/image-storage.js";
import { setAdminCredentials } from "../../src/modules/authentication/admin-account.js";
import { syncDemoAccountFromConfig } from "../../src/modules/demo/demo-account.js";
import { DEMO_NEW_LISTINGS, DEMO_PRODUCTS } from "../../src/modules/demo/demo-data.js";
import { createDemoService, NotDemoAccountError } from "../../src/modules/demo/demo.service.js";
import { createFakeEbay, TEST_EBAY_ENV } from "../support/fake-ebay.js";
import { makeJpeg } from "../support/jpeg.js";
import { ADMIN_EMAIL, ADMIN_PASSWORD, client, cookieFrom, createTestApp, json, loginAsAdmin } from "./app-client.js";
import { createTestDatabase, productData, resetDatabase } from "./helpers.js";

const db = createTestDatabase();
const DEMO_EMAIL = "demo@example.com";
const DEMO_PASSWORD = "demo-password-123";
const DEMO_ENV = { DEMO_EMAIL, DEMO_PASSWORD };

const full = makeJpeg(2048, 1536, 300_000);
const thumb = makeJpeg(600, 450, 30_000);

let storage: ReturnType<typeof createMemoryImageStorage>;
let ebay: ReturnType<typeof createFakeEbay>;

beforeEach(async () => {
  await resetDatabase(db);
  storage = createMemoryImageStorage();
  ebay = createFakeEbay();
});

afterAll(async () => {
  await db.$disconnect();
});

type Env = Record<string, string | undefined>;

function depsFor(env: Env = DEMO_ENV): AppDeps {
  return {
    config: loadConfig({ DATABASE_URL: "unused", NODE_ENV: "test", DEFAULT_CURRENCY: "EUR", ...env }),
    db,
    logger: createLogger({ sink: () => {} }),
    imageStorage: storage,
  };
}

const appFor = (env: Env = DEMO_ENV) => createTestApp(db, { imageStorage: storage, fetch: ebay.fetch }, env);
type App = ReturnType<typeof appFor>;

/** Signs in as the demo account (which restores its sample data). */
async function loginAsDemo(app: App, password = DEMO_PASSWORD) {
  const res = await client(app).post("/api/v1/auth/login", { email: DEMO_EMAIL, password });
  if (res.status !== 200) throw new Error(`Demo login failed with ${res.status}`);
  return { api: client(app, cookieFrom(res)!), user: (await json(res)).data };
}

/** The usual starting point: an administrator and a demo account, both signed in to the same app. */
async function bothSignedIn(env: Env = DEMO_ENV) {
  const app = appFor(env);
  const admin = await loginAsAdmin(db, app);
  await syncDemoAccountFromConfig(depsFor(env));
  const demo = await loginAsDemo(app);
  return { app, admin: admin.api, demo: demo.api, demoUser: demo.user };
}

const demoUser = () => db.adminUser.findFirstOrThrow({ where: { role: "DEMO" } });
const adminUser = () => db.adminUser.findFirstOrThrow({ where: { role: "ADMIN" } });
const allProducts = async (api: ReturnType<typeof client>) =>
  (await json(await api.get("/api/v1/products?status=ALL&pageSize=100"))).data as { id: string; name: string }[];

describe("demo account setup from DEMO_EMAIL / DEMO_PASSWORD", () => {
  it("is off when the variables are not set", async () => {
    expect(await syncDemoAccountFromConfig(depsFor({}))).toBe("off");
    expect(await db.adminUser.count()).toBe(0);
  });

  it("creates the account with the sample items, then leaves it alone on later starts", async () => {
    expect(await syncDemoAccountFromConfig(depsFor())).toBe("created");
    const user = await demoUser();
    expect(user).toMatchObject({ email: DEMO_EMAIL, role: "DEMO", demoChangesUsed: 0 });
    expect(await db.product.count({ where: { ownerId: user.id } })).toBe(DEMO_PRODUCTS.length);
    expect(await db.sale.count()).toBe(DEMO_PRODUCTS.filter((item) => item.sale).length);

    expect(await syncDemoAccountFromConfig(depsFor())).toBe("unchanged");
    expect(await db.adminUser.count({ where: { role: "DEMO" } })).toBe(1);
  });

  it("uses sample eBay IDs that can never be real ones (real IDs are digits only)", () => {
    const ids = DEMO_PRODUCTS.flatMap((item) => [item.ebayItemId, item.sale?.orderId, item.sale?.lineItemId]).filter(Boolean);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id).toMatch(/^DEMO-/);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("applies a changed password and signs out existing demo sessions", async () => {
    const app = appFor();
    await syncDemoAccountFromConfig(depsFor());
    const { api } = await loginAsDemo(app);
    expect((await api.get("/api/v1/auth/me")).status).toBe(200);

    const changed = { DEMO_EMAIL: "showcase@example.com", DEMO_PASSWORD: "another-password-456" };
    expect(await syncDemoAccountFromConfig(depsFor(changed))).toBe("updated");

    expect((await api.get("/api/v1/auth/me")).status).toBe(401);
    expect((await client(app).post("/api/v1/auth/login", { email: DEMO_EMAIL, password: DEMO_PASSWORD })).status).toBe(401);
    const withNew = await client(app).post("/api/v1/auth/login", { email: changed.DEMO_EMAIL, password: changed.DEMO_PASSWORD });
    expect(withNew.status).toBe(200);
    expect(await db.adminUser.count({ where: { role: "DEMO" } })).toBe(1);
  });

  it("deletes the account with its items, photos and sessions when the variables are removed", async () => {
    const { admin, demo } = await bothSignedIn();
    const mine = (await json(await admin.post("/api/v1/products", { name: "Admin item", price: "10.00" }))).data;
    await admin.upload(`/api/v1/products/${mine.id}/images`, { image: full, thumbnail: thumb });
    const sample = (await allProducts(demo))[0]!;
    await demo.upload(`/api/v1/products/${sample.id}/images`, { image: full, thumbnail: thumb });
    expect(storage.objects.size).toBe(4);

    expect(await syncDemoAccountFromConfig(depsFor({}))).toBe("removed");

    expect(await db.adminUser.count({ where: { role: "DEMO" } })).toBe(0);
    expect((await demo.get("/api/v1/auth/me")).status).toBe(401);
    // Only the administrator's item, photo and session are left.
    expect((await db.product.findMany()).map((product) => product.name)).toEqual(["Admin item"]);
    expect(await db.sale.count()).toBe(0);
    expect([...storage.objects.keys()].every((key) => key.startsWith(`products/${mine.id}/`))).toBe(true);
    expect(storage.objects.size).toBe(2);
    expect((await admin.get("/api/v1/auth/me")).status).toBe(200);
  });

  it("stays off (without stopping the app) when the password is too short", async () => {
    expect(await syncDemoAccountFromConfig(depsFor({ DEMO_EMAIL, DEMO_PASSWORD: "short" }))).toBe("invalid");
    expect(await db.adminUser.count()).toBe(0);
  });

  it("refuses to reuse the administrator's email and never changes the administrator", async () => {
    await setAdminCredentials(db, ADMIN_EMAIL, ADMIN_PASSWORD);
    const before = await adminUser();

    const outcome = await syncDemoAccountFromConfig(depsFor({ DEMO_EMAIL: ADMIN_EMAIL, DEMO_PASSWORD }));

    expect(outcome).toBe("invalid");
    expect(await db.adminUser.count()).toBe(1);
    expect(await adminUser()).toMatchObject({ role: "ADMIN", passwordHash: before.passwordHash });
  });

  it("is left untouched when the administrator's password is changed", async () => {
    const { demo } = await bothSignedIn();
    await setAdminCredentials(db, "new-owner@example.com", "a-brand-new-passphrase");

    expect(await db.adminUser.count({ where: { role: "DEMO" } })).toBe(1);
    expect(await db.adminUser.count({ where: { role: "ADMIN" } })).toBe(1);
    expect((await demo.get("/api/v1/auth/me")).status).toBe(200);
  });
});

describe("who am I", () => {
  it("reports the role and, for the demo account, its change allowance", async () => {
    const { admin, demo, demoUser: atLogin } = await bothSignedIn();

    expect(atLogin).toMatchObject({ email: DEMO_EMAIL, role: "DEMO", demo: { changesUsed: 0, changesLimit: 5 } });
    expect((await json(await demo.get("/api/v1/auth/me"))).data).toMatchObject({
      role: "DEMO",
      demo: { changesUsed: 0, changesLimit: 5 },
    });
    expect((await json(await admin.get("/api/v1/auth/me"))).data).toMatchObject({ role: "ADMIN", demo: null });
  });
});

describe("the two accounts never see or change each other's items", () => {
  async function setup() {
    const ctx = await bothSignedIn();
    const adminItem = (await json(await ctx.admin.post("/api/v1/products", { name: "Admin only camera", price: "500.00" }))).data;
    const photo = (await json(await ctx.admin.upload(`/api/v1/products/${adminItem.id}/images`, { image: full, thumbnail: thumb }))).data;
    const sale = await db.sale.create({
      data: {
        productId: adminItem.id,
        ebayOrderId: "12-34567-89012",
        ebayLineItemId: "1",
        soldPrice: new Prisma.Decimal("500"),
        currency: "EUR",
        soldAt: new Date("2026-06-01T10:00:00Z"),
      },
    });
    const demoItem = (await allProducts(ctx.demo)).find((product) => product.name.startsWith("Vintage gooseneck"))!;
    return { ...ctx, adminItem, photo, sale, demoItem };
  }

  it("keeps the product lists apart", async () => {
    const { admin, demo } = await setup();
    const demoNames = (await allProducts(demo)).map((product) => product.name);
    expect(demoNames).toHaveLength(DEMO_PRODUCTS.length);
    expect(demoNames).not.toContain("Admin only camera");
    expect((await allProducts(admin)).map((product) => product.name)).toEqual(["Admin only camera"]);
    // Search can't reach across accounts either.
    expect((await json(await demo.get("/api/v1/products?status=ALL&search=Admin"))).data).toEqual([]);
    expect((await json(await admin.get("/api/v1/products?status=ALL&search=Leica"))).data).toEqual([]);
  });

  it("answers 'not found' when the demo account addresses the administrator's product, and changes nothing", async () => {
    const { demo, adminItem, photo } = await setup();
    const base = `/api/v1/products/${adminItem.id}`;

    const attempts = [
      await demo.get(base),
      await demo.patch(base, { name: "Taken over" }),
      await demo.patch(`${base}/status`, { status: "ARCHIVED" }),
      await demo.delete(base),
      await demo.get(`${base}/status-history`),
      await demo.get(`${base}/sales`),
      await demo.upload(`${base}/images`, { image: full, thumbnail: thumb }),
      await demo.put(`${base}/images/order`, { imageIds: [photo.id] }),
      await demo.delete(`${base}/images/${photo.id}`),
      await demo.get(`/api/v1/images/${photo.id}`),
      await demo.get(`/api/v1/images/${photo.id}/thumb`),
    ];
    expect(attempts.map((res) => res.status)).toEqual(attempts.map(() => 404));

    const unchanged = await db.product.findUniqueOrThrow({ where: { id: adminItem.id }, include: { images: true } });
    expect(unchanged).toMatchObject({ name: "Admin only camera", status: "AVAILABLE" });
    expect(unchanged.images).toHaveLength(1);
    // None of the refused attempts used up the demo allowance.
    expect((await demoUser()).demoChangesUsed).toBe(0);
  });

  it("answers 'not found' when the administrator addresses a demo product", async () => {
    const { admin, demoItem } = await setup();
    const base = `/api/v1/products/${demoItem.id}`;
    expect((await admin.get(base)).status).toBe(404);
    expect((await admin.patch(base, { name: "Changed" })).status).toBe(404);
    expect((await admin.delete(base)).status).toBe(404);
    expect(await db.product.count({ where: { id: demoItem.id, name: demoItem.name } })).toBe(1);
  });

  it("keeps sales apart", async () => {
    const { admin, demo, sale } = await setup();
    const demoOrders = (await json(await demo.get("/api/v1/sales"))).data.map((row: { ebayOrderId: string }) => row.ebayOrderId);
    expect(demoOrders.sort()).toEqual(["DEMO-ORDER-1001", "DEMO-ORDER-1002"]);
    expect((await demo.get(`/api/v1/sales/${sale.id}`)).status).toBe(404);
    expect((await json(await demo.get("/api/v1/sales?search=12-34567"))).data).toEqual([]);

    const adminOrders = (await json(await admin.get("/api/v1/sales"))).data.map((row: { ebayOrderId: string }) => row.ebayOrderId);
    expect(adminOrders).toEqual(["12-34567-89012"]);
  });

  it("gives each account its own dashboard and hides the eBay connection from the demo account", async () => {
    const { admin, demo } = await setup();
    await db.ebayAccount.create({
      data: { sellerUsername: "real-seller", marketplaceId: "EBAY_DE", connectionStatus: "CONNECTED", connectedAt: new Date() },
    });

    const forDemo = (await json(await demo.get("/api/v1/dashboard/summary"))).data;
    expect(forDemo.products.total).toBe(DEMO_PRODUCTS.length);
    expect(forDemo.recentSales.map((row: { ebayOrderId: string }) => row.ebayOrderId).sort()).toEqual(["DEMO-ORDER-1001", "DEMO-ORDER-1002"]);
    expect(forDemo.ebay).toEqual({ connectionStatus: "NOT_CONNECTED", sellerUsername: null, marketplaceId: null });
    expect(forDemo.warnings).toEqual([]);
    expect(JSON.stringify(forDemo)).not.toContain("real-seller");

    const forAdmin = (await json(await admin.get("/api/v1/dashboard/summary"))).data;
    expect(forAdmin.products.total).toBe(1);
    expect(forAdmin.recentSales).toHaveLength(1);
    expect(forAdmin.ebay).toMatchObject({ connectionStatus: "CONNECTED", sellerUsername: "real-seller" });
  });
});

describe("eBay is closed to the demo account", () => {
  it("refuses every eBay route and never contacts eBay", async () => {
    const env = { ...DEMO_ENV, ...TEST_EBAY_ENV };
    const { demo } = await bothSignedIn(env);
    await db.ebayAccount.create({
      data: { sellerUsername: "real-seller", marketplaceId: "EBAY_DE", connectionStatus: "CONNECTED", connectedAt: new Date() },
    });

    const refused = [
      await demo.get("/api/v1/integrations/ebay"),
      await demo.get("/api/v1/integrations/ebay/listings"),
      await demo.post("/api/v1/integrations/ebay/listings/import", {}),
      await demo.post("/api/v1/integrations/ebay/disconnect"),
    ];
    for (const res of refused) {
      expect(res.status).toBe(403);
      const body = await json(res);
      expect(body.error.code).toBe("DEMO_NOT_AVAILABLE");
      expect(JSON.stringify(body)).not.toContain("real-seller");
    }

    // The two browser-navigation routes send the demo account back with an explanation.
    const connect = await demo.get("/api/v1/integrations/ebay/connect");
    expect(connect.status).toBe(302);
    expect(connect.headers.get("location")).toBe("/settings/ebay?error=demo");
    const callback = await demo.get("/api/v1/integrations/ebay/callback?state=anything&code=anything");
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/settings/ebay?error=demo");

    expect(ebay.requests).toHaveLength(0);
    expect(await db.oAuthState.count()).toBe(0);
    expect(await db.ebayAccount.findFirstOrThrow()).toMatchObject({ connectionStatus: "CONNECTED", sellerUsername: "real-seller" });
    expect((await demoUser()).demoChangesUsed).toBe(0);
  });

  it("refuses API paths that are not on the demo allow-list, even ones that don't exist", async () => {
    const { demo } = await bothSignedIn();
    const res = await demo.get("/api/v1/some-future-module");
    expect(res.status).toBe(403);
    expect((await json(res)).error.code).toBe("DEMO_NOT_AVAILABLE");
  });
});

describe("simulated eBay for the demo account", () => {
  const E = "/api/v1/demo/ebay";
  const sampleFull = makeJpeg(1280, 960, 150_000);
  const sampleThumb = makeJpeg(600, 450, 30_000);
  const demoPhotos = async (fileName: string) => (fileName.endsWith("_thumb.jpg") ? sampleThumb : sampleFull);

  /** Like `bothSignedIn`, with the bundled sample photos available. */
  async function setup() {
    const env = { ...DEMO_ENV, ...TEST_EBAY_ENV };
    const app = createTestApp(db, { imageStorage: storage, fetch: ebay.fetch, demoPhotos }, env);
    const admin = await loginAsAdmin(db, app);
    await syncDemoAccountFromConfig({ ...depsFor(env), demoPhotos });
    const demo = await loginAsDemo(app);
    return { app, admin: admin.api, demo: demo.api };
  }

  it("starts not connected and refuses listings until the sample account is connected", async () => {
    const { demo } = await setup();

    const status = (await json(await demo.get(E))).data;
    expect(status).toMatchObject({ configured: true, connectionStatus: "NOT_CONNECTED", sellerUsername: null, connectedAt: null });
    expect(status.photoCredits.length).toBeGreaterThan(0);

    for (const res of [await demo.get(`${E}/listings`), await demo.post(`${E}/listings/import`, {})]) {
      expect(res.status).toBe(409);
      expect((await json(res)).error.code).toBe("EBAY_NOT_CONNECTED");
    }
    expect(await db.product.count({ where: { owner: { role: "DEMO" } } })).toBe(DEMO_PRODUCTS.length);
  });

  it("connects and disconnects without using up changes, and shows it on the dashboard", async () => {
    const { demo } = await setup();

    const connected = (await json(await demo.post(`${E}/connect`))).data;
    expect(connected).toMatchObject({ connectionStatus: "CONNECTED", sellerUsername: "sample_seller", marketplaceId: "EBAY_DE" });
    expect(new Date(connected.refreshTokenExpiresAt).getTime()).toBeGreaterThan(Date.now());
    expect((await json(await demo.get("/api/v1/dashboard/summary"))).data.ebay).toEqual({
      connectionStatus: "CONNECTED",
      sellerUsername: "sample_seller",
      marketplaceId: "EBAY_DE",
    });

    const disconnected = (await json(await demo.post(`${E}/disconnect`))).data;
    expect(disconnected).toMatchObject({ connectionStatus: "NOT_CONNECTED", sellerUsername: null });
    expect((await demo.get(`${E}/listings`)).status).toBe(409);
    expect((await demoUser()).demoChangesUsed).toBe(0);
  });

  it("lists the sample account's listings: those already in the inventory and those that can be added", async () => {
    const { demo } = await setup();
    await demo.post(`${E}/connect`);

    const listings = (await json(await demo.get(`${E}/listings`))).data;
    const expected = DEMO_PRODUCTS.filter((item) => item.ebayItemId && !item.sale).length + DEMO_NEW_LISTINGS.length;
    expect(listings).toHaveLength(expected);

    const inInventory = listings.filter((listing: { productId: string | null }) => listing.productId);
    const toAdd = listings.filter((listing: { productId: string | null }) => !listing.productId);
    expect(inInventory.map((listing: { itemId: string }) => listing.itemId).sort()).toEqual(["DEMO-1001", "DEMO-1002", "DEMO-1004", "DEMO-1005"]);
    expect(toAdd.map((listing: { itemId: string }) => listing.itemId)).toEqual(DEMO_NEW_LISTINGS.map((listing) => listing.itemId));
    for (const listing of listings) {
      expect(listing).toMatchObject({ currency: "EUR", listingUrl: null, listingType: "FixedPriceItem" });
      expect(listing.imageUrl).toMatch(/^\/api\/v1\/demo\/ebay\/pictures\/[a-z0-9-]+\/s-l140\.jpg$/);
    }
    // Sold sample items are not active listings.
    expect(listings.map((listing: { itemId: string }) => listing.itemId)).not.toContain("DEMO-1003");
  });

  it("adds a sample listing through the real import: product, listing link, history, photo credit", async () => {
    const { demo } = await setup();
    await demo.post(`${E}/connect`);

    const res = await demo.post(`${E}/listings/import`, { itemIds: ["DEMO-2001"] });
    expect(res.status).toBe(200);
    const { data } = await json(res);
    expect(data.created).toHaveLength(1);
    expect(data.skipped).toEqual([]);

    const product = (await json(await demo.get(`/api/v1/products/${data.created[0].productId}`))).data;
    expect(product).toMatchObject({
      name: DEMO_NEW_LISTINGS[0]!.title,
      price: "189.00",
      currency: "EUR",
      status: "AVAILABLE",
      description: "Photo: RRT877, CC0, via Wikimedia Commons.",
      images: [],
      listing: {
        ebayItemId: "DEMO-2001",
        listingStatus: "ACTIVE",
        listingUrl: null,
        imageUrl: "/api/v1/demo/ebay/pictures/canon-ae1/s-l140.jpg",
      },
    });
    const history = (await json(await demo.get(`/api/v1/products/${product.id}/status-history`))).data;
    expect(history[0]).toMatchObject({ source: "IMPORT", reason: "Imported from eBay listing DEMO-2001" });

    // It belongs to the demo account, counts as one change, and now shows as "in inventory".
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id }, include: { owner: true } })).owner.role).toBe("DEMO");
    expect((await demoUser()).demoChangesUsed).toBe(1);
    const listings = (await json(await demo.get(`${E}/listings`))).data;
    expect(listings.find((listing: { itemId: string }) => listing.itemId === "DEMO-2001").productId).toBe(product.id);
  });

  it("adds all remaining listings in one go, as a single change, and is safe to repeat", async () => {
    const { demo } = await setup();
    await demo.post(`${E}/connect`);

    const first = (await json(await demo.post(`${E}/listings/import`, {}))).data;
    expect(first.created.map((entry: { itemId: string }) => entry.itemId)).toEqual(DEMO_NEW_LISTINGS.map((listing) => listing.itemId));
    expect(first.skipped).toHaveLength(4);
    expect((await demoUser()).demoChangesUsed).toBe(1);

    const again = (await json(await demo.post(`${E}/listings/import`, {}))).data;
    expect(again.created).toEqual([]);
    expect(await db.product.count({ where: { owner: { role: "DEMO" } } })).toBe(DEMO_PRODUCTS.length + DEMO_NEW_LISTINGS.length);
  });

  it("rejects anything that is not a sample item ID and respects the change limit", async () => {
    const { demo } = await setup();
    await demo.post(`${E}/connect`);

    expect((await demo.post(`${E}/listings/import`, { itemIds: ["125000000001"] })).status).toBe(400);
    expect((await demoUser()).demoChangesUsed).toBe(0);

    for (let i = 0; i < 5; i++) await demo.post("/api/v1/products", { name: `Item ${i}`, price: "1.00" });
    const refused = await demo.post(`${E}/listings/import`, { itemIds: ["DEMO-2002"] });
    expect(refused.status).toBe(403);
    expect((await json(refused)).error.code).toBe("DEMO_LIMIT_REACHED");
    // Connecting and disconnecting still work once the changes are used up.
    expect((await demo.post(`${E}/disconnect`)).status).toBe(200);
    expect((await demo.post(`${E}/connect`)).status).toBe(200);
  });

  it("serves sample pictures like eBay does: small sizes as thumbnail, large ones in full", async () => {
    const { demo, app } = await setup();

    const small = await demo.get(`${E}/pictures/canon-ae1/s-l140.jpg`);
    expect(small.status).toBe(200);
    expect(small.headers.get("content-type")).toBe("image/jpeg");
    expect((await small.arrayBuffer()).byteLength).toBe(sampleThumb.byteLength);
    expect((await (await demo.get(`${E}/pictures/canon-ae1/s-l500.jpg`)).arrayBuffer()).byteLength).toBe(sampleThumb.byteLength);
    expect((await (await demo.get(`${E}/pictures/canon-ae1/s-l1600.jpg`)).arrayBuffer()).byteLength).toBe(sampleFull.byteLength);

    // Only pictures of sample listings, only well-formed names, only when signed in.
    expect((await demo.get(`${E}/pictures/braun-sk4/s-l140.jpg`)).status).toBe(404); // sold item: not a listing
    expect((await demo.get(`${E}/pictures/not-a-photo/s-l140.jpg`)).status).toBe(404);
    expect((await demo.get(`${E}/pictures/canon-ae1/original.jpg`)).status).toBe(400);
    expect((await demo.get(`${E}/pictures/..%2F..%2Fpackage/s-l140.jpg`)).status).not.toBe(200);
    expect((await client(app).get(`${E}/pictures/canon-ae1/s-l140.jpg`)).status).toBe(401);
  });

  it("is reset at the next sign-in: not connected, added listings gone", async () => {
    const { app, demo } = await setup();
    await demo.post(`${E}/connect`);
    await demo.post(`${E}/listings/import`, {});

    const again = await loginAsDemo(app);

    expect((await json(await again.api.get(E))).data.connectionStatus).toBe("NOT_CONNECTED");
    expect(await db.product.count({ where: { owner: { role: "DEMO" } } })).toBe(DEMO_PRODUCTS.length);
    expect(await db.ebayListing.count({ where: { ebayItemId: { startsWith: "DEMO-2" } } })).toBe(0);
  });

  it("never touches eBay or the administrator's real connection, and does not exist for the administrator", async () => {
    const { admin, demo } = await setup();
    await db.ebayAccount.create({
      data: { sellerUsername: "real-seller", marketplaceId: "EBAY_DE", connectionStatus: "CONNECTED", connectedAt: new Date() },
    });

    await demo.post(`${E}/connect`);
    const listings = await demo.get(`${E}/listings`);
    await demo.post(`${E}/listings/import`, {});
    await demo.post(`${E}/disconnect`);

    expect(JSON.stringify(await json(listings))).not.toContain("real-seller");
    expect(ebay.requests).toHaveLength(0);
    expect(await db.ebayAccount.findFirstOrThrow()).toMatchObject({ connectionStatus: "CONNECTED", sellerUsername: "real-seller" });
    // The real eBay routes stay closed to the demo account.
    expect((await demo.get("/api/v1/integrations/ebay/listings")).status).toBe(403);

    // The administrator has no simulated eBay, and the simulation never changes the administrator's row.
    for (const res of [await admin.get(E), await admin.post(`${E}/connect`), await admin.get(`${E}/listings`), await admin.post(`${E}/listings/import`, {})]) {
      expect(res.status).toBe(404);
    }
    expect((await adminUser()).demoEbayConnectedAt).toBeNull();
    expect(await db.product.count({ where: { owner: { role: "ADMIN" } } })).toBe(0);
  });
});

describe("the demo change allowance", () => {
  it("allows five changes of any kind, then refuses further ones while reading keeps working", async () => {
    const { demo } = await bothSignedIn();
    const lamp = (await allProducts(demo)).find((product) => product.name.startsWith("Vintage gooseneck"))!;

    const created = await demo.post("/api/v1/products", { name: "My test item", price: "12.00" }); // 1
    expect(created.status).toBe(201);
    const createdId = (await json(created)).data.id;
    expect((await demo.patch(`/api/v1/products/${lamp.id}`, { name: "Renamed lamp" })).status).toBe(200); // 2
    expect((await demo.patch(`/api/v1/products/${lamp.id}/status`, { status: "RESERVED" })).status).toBe(200); // 3
    const photo = await demo.upload(`/api/v1/products/${lamp.id}/images`, { image: full, thumbnail: thumb }); // 4
    expect(photo.status).toBe(201);
    expect((await demo.delete(`/api/v1/products/${createdId}`)).status).toBe(204); // 5

    expect((await json(await demo.get("/api/v1/auth/me"))).data.demo).toEqual({ changesUsed: 5, changesLimit: 5 });

    const sixth = await demo.patch(`/api/v1/products/${lamp.id}`, { name: "One too many" });
    expect(sixth.status).toBe(403);
    expect((await json(sixth)).error).toMatchObject({
      code: "DEMO_LIMIT_REACHED",
      message: "The demo account allows 5 changes. Sign out and in again to start over with fresh sample data.",
    });
    expect((await demo.post("/api/v1/products", { name: "Another", price: "1.00" })).status).toBe(403);
    expect((await demo.upload(`/api/v1/products/${lamp.id}/images`, { image: full, thumbnail: thumb })).status).toBe(403);

    // Nothing changed after the limit, and reading still works.
    expect((await json(await demo.get(`/api/v1/products/${lamp.id}`))).data).toMatchObject({ name: "Renamed lamp", status: "RESERVED" });
    expect(await allProducts(demo)).toHaveLength(DEMO_PRODUCTS.length);
    expect((await demo.get("/api/v1/dashboard/summary")).status).toBe(200);
    expect((await demoUser()).demoChangesUsed).toBe(5);
  });

  it("does not count requests that fail", async () => {
    const { demo } = await bothSignedIn();
    const sold = (await allProducts(demo)).find((product) => product.name.startsWith("Braun"))!;

    expect((await demo.post("/api/v1/products", { name: "", price: "abc" })).status).toBe(400); // validation
    expect((await demo.patch("/api/v1/products/00000000-0000-4000-8000-000000000000", { name: "x" })).status).toBe(404);
    expect((await demo.delete(`/api/v1/products/${sold.id}`)).status).toBe(409); // has a sale
    expect((await demo.patch(`/api/v1/products/${sold.id}/status`, { status: "SOLD" })).status).toBe(409); // unchanged

    expect((await demoUser()).demoChangesUsed).toBe(0);
    expect((await json(await demo.get("/api/v1/auth/me"))).data.demo.changesUsed).toBe(0);
  });

  it("cannot be exceeded by sending requests at the same time", async () => {
    const { demo } = await bothSignedIn();
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => demo.post("/api/v1/products", { name: `Parallel ${i}`, price: "1.00" })),
    );
    expect(results.filter((res) => res.status === 201)).toHaveLength(5);
    expect(results.filter((res) => res.status === 403)).toHaveLength(7);
    expect(await db.product.count({ where: { name: { startsWith: "Parallel" } } })).toBe(5);
  });

  it("follows DEMO_CHANGE_LIMIT", async () => {
    const { demo, demoUser: atLogin } = await bothSignedIn({ ...DEMO_ENV, DEMO_CHANGE_LIMIT: "1" });
    expect(atLogin.demo).toEqual({ changesUsed: 0, changesLimit: 1 });
    expect((await demo.post("/api/v1/products", { name: "First", price: "1.00" })).status).toBe(201);
    const second = await demo.post("/api/v1/products", { name: "Second", price: "1.00" });
    expect(second.status).toBe(403);
    expect((await json(second)).error.message).toContain("allows 1 change.");
  });

  it("does not limit the administrator", async () => {
    const { admin } = await bothSignedIn();
    for (let i = 0; i < 8; i++) {
      expect((await admin.post("/api/v1/products", { name: `Item ${i}`, price: "1.00" })).status).toBe(201);
    }
    expect((await adminUser()).demoChangesUsed).toBe(0);
  });
});

describe("sample photos", () => {
  const sampleFull = makeJpeg(1280, 960, 150_000);
  const sampleThumb = makeJpeg(600, 450, 30_000);
  const withPhotos = DEMO_PRODUCTS.filter((item) => item.photo).length;

  /** A photo source that has every bundled file except the ones listed in `missing`. */
  const photoSource = (missing: string[] = []) => async (fileName: string) =>
    missing.includes(fileName) ? null : fileName.endsWith("_thumb.jpg") ? sampleThumb : sampleFull;

  function setup(demoPhotos: AppDeps["demoPhotos"]) {
    const app = createTestApp(db, { imageStorage: storage, fetch: ebay.fetch, demoPhotos }, DEMO_ENV);
    return { app, deps: { ...depsFor(), demoPhotos } };
  }

  it("gives every sample item its photo, with the credit in the description", async () => {
    const { app, deps } = setup(photoSource());
    await syncDemoAccountFromConfig(deps);
    const { api } = await loginAsDemo(app);

    expect(withPhotos).toBe(DEMO_PRODUCTS.length);
    const products = (await json(await api.get("/api/v1/products?status=ALL&pageSize=100"))).data;
    for (const product of products) {
      expect(product.images).toHaveLength(1);
      expect(product.images[0]).toMatchObject({ width: 1280, height: 960, position: 0 });
      expect(product.description).toMatch(/\n\nPhoto: .+, via Wikimedia Commons\.$/);
    }
    // The photo is served like any uploaded one.
    const served = await api.get(products[0].images[0].thumbUrl);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/jpeg");
    expect(storage.objects.size).toBe(withPhotos * 2);
  });

  it("replaces the stored files at every sign-in instead of piling them up", async () => {
    const { app, deps } = setup(photoSource());
    await syncDemoAccountFromConfig(deps);
    await loginAsDemo(app);
    const before = new Set(storage.objects.keys());

    await loginAsDemo(app);

    expect(storage.objects.size).toBe(withPhotos * 2);
    expect([...storage.objects.keys()].some((key) => before.has(key))).toBe(false);
    expect(await db.productImage.count()).toBe(withPhotos);
  });

  it("lets the visitor remove a sample photo (one change) and brings it back at the next sign-in", async () => {
    const { app, deps } = setup(photoSource());
    await syncDemoAccountFromConfig(deps);
    const { api } = await loginAsDemo(app);
    const product = (await allProducts(api))[0]! as { id: string; images?: { id: string }[] };
    const detail = (await json(await api.get(`/api/v1/products/${product.id}`))).data;

    expect((await api.delete(`/api/v1/products/${product.id}/images/${detail.images[0].id}`)).status).toBe(204);
    expect((await demoUser()).demoChangesUsed).toBe(1);
    expect(storage.objects.size).toBe((withPhotos - 1) * 2);

    await loginAsDemo(app);
    expect(storage.objects.size).toBe(withPhotos * 2);
  });

  it("shows an item without photo or credit when its file is missing", async () => {
    const { app, deps } = setup(photoSource(["leica-m3_thumb.jpg"]));
    await syncDemoAccountFromConfig(deps);
    const { api } = await loginAsDemo(app);

    const products = (await json(await api.get("/api/v1/products?status=ALL&pageSize=100"))).data;
    const leica = products.find((product: { name: string }) => product.name.startsWith("Leica"));
    expect(leica.images).toEqual([]);
    expect(leica.description).not.toContain("Photo:");
    expect(storage.objects.size).toBe((withPhotos - 1) * 2);
  });

  it("removes them from storage together with the demo account", async () => {
    const { app, deps } = setup(photoSource());
    await syncDemoAccountFromConfig(deps);
    await loginAsDemo(app);

    expect(await syncDemoAccountFromConfig({ ...deps, config: depsFor({}).config })).toBe("removed");
    expect(storage.objects.size).toBe(0);
  });

  it("leaves no files behind when storage fails during the reset", async () => {
    const { app, deps } = setup(photoSource());
    await syncDemoAccountFromConfig(deps);
    await loginAsDemo(app);
    const namesBefore = (await db.product.findMany({ select: { id: true } })).map((row) => row.id).sort();
    const keysBefore = [...storage.objects.keys()].sort();

    const put = storage.put;
    let calls = 0;
    storage.put = async (key, bytes, contentType) => {
      calls += 1;
      if (calls === 7) throw new Error("storage is down");
      return put(key, bytes, contentType);
    };
    const res = await client(app).post("/api/v1/auth/login", { email: DEMO_EMAIL, password: DEMO_PASSWORD });
    storage.put = put;

    expect(res.status).toBe(500);
    // The previous sample data and its photos are still there, and nothing new was left behind.
    expect((await db.product.findMany({ select: { id: true } })).map((row) => row.id).sort()).toEqual(namesBefore);
    expect([...storage.objects.keys()].sort()).toEqual(keysBefore);
  });
});

describe("restoring the sample data", () => {
  it("happens at every demo sign-in: changes and photos are gone, the allowance is full again", async () => {
    const { app, admin, demo } = await bothSignedIn();
    await admin.post("/api/v1/products", { name: "Admin item", price: "10.00" });
    const lamp = (await allProducts(demo)).find((product) => product.name.startsWith("Vintage gooseneck"))!;
    await demo.post("/api/v1/products", { name: "Visitor's item", price: "5.00" });
    await demo.patch(`/api/v1/products/${lamp.id}`, { name: "Renamed lamp" });
    await demo.upload(`/api/v1/products/${lamp.id}/images`, { image: full, thumbnail: thumb });
    expect(storage.objects.size).toBe(2);

    const again = await loginAsDemo(app);

    expect(again.user.demo).toEqual({ changesUsed: 0, changesLimit: 5 });
    const names = (await allProducts(again.api)).map((product) => product.name).sort();
    expect(names).toEqual(DEMO_PRODUCTS.map((item) => item.name).sort());
    expect(storage.objects.size).toBe(0);
    expect(await db.productImage.count()).toBe(0);
    // The administrator's inventory is not part of any of this.
    expect((await allProducts(admin)).map((product) => product.name)).toEqual(["Admin item"]);
  });

  it("is not triggered by a wrong password", async () => {
    const { app, demo } = await bothSignedIn();
    await demo.post("/api/v1/products", { name: "Visitor's item", price: "5.00" });

    const res = await client(app).post("/api/v1/auth/login", { email: DEMO_EMAIL, password: "not-the-password" });

    expect(res.status).toBe(401);
    expect((await allProducts(demo)).map((product) => product.name)).toContain("Visitor's item");
    expect((await demoUser()).demoChangesUsed).toBe(1);
  });

  it("refuses to run for the administrator and leaves the administrator's items alone", async () => {
    await setAdminCredentials(db, ADMIN_EMAIL, ADMIN_PASSWORD);
    const product = await db.product.create({ data: productData({ name: "Precious" }) });
    const service = createDemoService(depsFor());

    await expect(service.reset(product.ownerId)).rejects.toBeInstanceOf(NotDemoAccountError);
    expect(await service.reserveChange(product.ownerId)).toBe(false);

    expect((await db.product.findMany()).map((row) => row.name)).toEqual(["Precious"]);
    expect((await adminUser()).demoChangesUsed).toBe(0);
  });

  it("does not happen when the administrator signs in", async () => {
    const { app, admin } = await bothSignedIn();
    await admin.post("/api/v1/products", { name: "Admin item", price: "10.00" });
    await client(app).post("/api/v1/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect((await allProducts(admin)).map((product) => product.name)).toEqual(["Admin item"]);
  });
});
