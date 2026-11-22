# Architecture & decisions

## Shape

A **modular monolith**: one backend process, one database, one SPA.

```
Browser (React SPA) ──/api/v1──▶ Hono backend ──▶ PostgreSQL (source of truth)
                                     │  ▲
                             OAuth,  │  │ account-deletion notices (acknowledged only)
                     Fulfillment,    ▼  │
                     Trading API ──▶ eBay
```

- The frontend never calls eBay. It reads only from the backend, which reads only from Postgres.
  If eBay is down, the UI still shows the last known state.
- Modules live under `backend/src/modules/<name>/` and receive dependencies (`config`, `db`, `logger`, `now`) through an `AppDeps` object. There are no global singletons, which keeps them testable without mocking frameworks.

## Portability (future Cloudflare Workers + Supabase)

Portability is isolated, not solved:

| File | Runtime-specific? |
|---|---|
| `src/app.ts`, modules, `common/`, `config/` | No. They use Hono and Web APIs only (`atob`, `fetch`, `performance`). Config is parsed from a plain record, so Worker bindings can be passed in. |
| `src/server.ts` | **Node only**: listener, signals, `process.env`. A Workers build would add a separate `worker.ts` entry. |
| `src/infrastructure/database.ts` | The single swap point for DB connectivity. Prisma 7 uses driver adapters (`@prisma/adapter-pg` over `pg` today). The Workers path (Hyperdrive or a Supabase pooler, plus the generated client's runtime setting) is **untested**. |
| Scheduling (later phases) | Will be plain functions (`runOrderSync()`, `retryNotifications()`) called from a Node timer locally and from Cron Triggers on Workers. Leases live in `sync_checkpoints`, so two runners can't overlap. |

## Data model notes

All models from the spec exist, with one deliberate removal decided by the owner (2026-11-10):

- **No SKU.** `Product.sku` and `EbayListing.ebaySku` were dropped (migration `20261110120000_remove_sku`). Items aren't labelled with codes and listings don't use eBay's Custom label. A product is identified by its UUID, and eBay order line items are matched to products **only by legacy item ID** (`EbayListing.ebayItemId`, globally unique). The spec's optional SKU-based secondary matching is intentionally not implemented. Product names need not be unique.

Additions are listed below, each with its reason:

| Addition | Why |
|---|---|
| `ProductStatusChange` (+ `StatusChangeSource` enum) | Rule 9 (full status history) and rule 10 (don't overwrite manual corrections): we need to know *who* set the current status. |
| `ReconciliationIssue` | One place for things that need a human decision: unmatched line items (Scenario D), cancellations (rule 8), conflicts with manual edits. Unique on `(type, ebayOrderId, ebayLineItemId)`, so re-syncs don't duplicate issues. |
| `SyncCheckpoint` | Cursor for incremental order sync (overlapping windows), plus a DB lease to prevent concurrent runs. Uses no Redis. |
| `OAuthState` | Single-use, expiring OAuth `state` values (CSRF protection for the connect flow). |
| `AdminUser`, `AdminSession` | Single-admin auth with server-side sessions. Only a SHA-256 hash of the session token is stored. |
| `EbayNotification.attempts / nextAttemptAt / lockedAt`, status `PROCESSING` | The notification table doubles as the durable retry queue (exponential backoff, stale-lock recovery). |
| `SyncStatus.RUNNING` | A sync log row is written at start, so a crashed run is visible. |
| `EbayListing.title` | Snapshot shown in the import wizard and kept for audits. |
| `EbayAccount.accessTokenEncrypted`, `refreshTokenExpiresAt`, `scopes`, `lastErrorMessage` | Cache the 2-hour access token across requests (needed on stateless runtimes), and warn before the refresh token expires. |
| `Sale.ebayItemId`, `quantity`, `ebayLastModifiedAt`, `cancelledAt`, `cancellationReason` | Audit trail and detection of orders modified after creation. |

Constraints that enforce business rules at the database level, each covered by an integration test:

- `sales (ebayOrderId, ebayLineItemId)` is unique, so a sale can never be duplicated, regardless of how many times a notification or sync repeats.
- `ebay_listings.ebayItemId` is **globally** unique. eBay legacy item IDs are unique across marketplaces, so this is stricter than "per marketplace/account" and makes order-to-product matching unambiguous.
- `ebay_listings.productId` is unique (one listing per product, v1).
- `sales.productId` uses `ON DELETE RESTRICT`, so a product with sales history can't be hard-deleted.
- `ebay_notifications.notificationId` is unique (NULLs allowed), so a redelivered notification is stored once.
- `ebay_listings.listingStatus` defaults to `UNKNOWN`; a listing is never assumed active.

Note on `ReconciliationIssue`: Postgres treats NULLs as distinct in unique indexes, so dedupe applies only to issues that carry both order and line-item IDs. That is always the case for the order-related issue types.

## Authentication & request security (Phase 2)

| Concern | Decision | Why |
|---|---|---|
| Password hashing | Argon2id via `hash-wasm` **4.12.0** (WASM), OWASP minimum parameters (m=19 MiB, t=2, p=1), encoded hash stores its parameters | WASM runs on Node *and* Workers (a native addon wouldn't). Pinned to the 2024 release: 4.13.0 was published the day this was built, and a brand-new release of a security dependency is a supply-chain risk. |
| Sessions | Random 256-bit token in an HttpOnly, SameSite=Lax cookie (`__Host-` prefix + Secure in production). Only its SHA-256 is stored. 7-day idle and 30-day absolute expiry, sliding (written back at most every 5 minutes). Logout and password changes revoke server-side. | Revocable, unlike JWTs. A DB leak doesn't yield usable tokens. Lax (not Strict) so the cookie survives the eBay OAuth redirect back to the app in Phase 3. |
| Route protection | Deny-by-default guard on `/api/v1/*` with an explicit public allow-list | A newly added route can't be accidentally public. Unauthenticated callers get 401 even for unknown routes, which avoids route enumeration. |
| CSRF | Mutations need an `X-Requested-With` header, and a present `Origin` must be allow-listed. Webhooks are exempt (they're verified by signature). | Custom headers force a CORS preflight that our CORS policy rejects cross-origin. Combined with SameSite cookies, this needs no token plumbing. |
| Login enumeration | Same 401 for unknown email and wrong password, with a dummy hash verified for unknown emails | Similar response timing either way. |
| Rate limiting | Fixed window, in-memory store behind a `RateLimitStore` interface. Client IP comes from the Node socket (`getConnInfo`), injected via `AppDeps.getClientIp`. | Correct for one Node process. A Workers or multi-instance deployment swaps the store and the IP source without touching modules. **Behind a reverse proxy, `getClientIp` must read the proxy's trusted header.** |
| Single admin | `AdminUser` table. `setAdminCredentials` creates the admin or updates the existing row, deleting any other row with role `ADMIN`. CLI script for password changes. | Spec: exactly one administrator. The optional demo account is a separate row with role `DEMO` (next section). |

## Demo account (2026-11-21)

An optional second login for showing the app to others. Owner's requirements: its own list of items, no connection to the real eBay account, and a small limit on changes.

| Concern | Decision | Why |
|---|---|---|
| Separation of data | `Product.ownerId` (required, FK to `admin_users`). Photos, listings, sales and status history belong to an account through their product. Every service method takes the signed-in account's ID first and puts it in the database filter (`modules/*/…service.ts`). | One database and one deployment, so no second hosting bill. The filter is in the query itself, not a check afterwards, so there is no window where another account's row is loaded. The migration (`20261121180000_demo_account`) assigns all existing products to the administrator and refuses to run if products exist without one. |
| Foreign IDs | Another account's product, photo or sale answers `404`, exactly like an ID that doesn't exist. | A `403` would confirm that the ID exists. |
| eBay | The demo account is refused before any eBay code runs: `demoRestrictions` (`modules/demo/demo.middleware.ts`) lets it reach only an allow-list of path prefixes (auth, health, products, images, sales, dashboard). The two browser-navigation routes that bypass the JSON guard (connect, callback) check the role themselves. The dashboard returns no eBay or sync state to it. | Allow-list, not block-list: a module added later is closed to the demo account until someone opens it. The eBay account is still a single global row; it stays the administrator's because nothing else can reach it. |
| Simulated eBay | `/demo/ebay/*` (`modules/demo/demo-ebay.*`): status, connect, disconnect, listings, import and listing pictures, with the same response shapes as the real eBay routes, so the web app uses one page and one set of components for both. "Connected" is a timestamp on the demo user (`demoEbayConnectedAt`), cleared at every sign-in. The import is the real `createEbayListingsService`, given the sample listings where eBay's answer would be. Picture addresses end in `s-l140.jpg` like eBay's, so the web app's size upgrade is exercised too. The routes answer 404 to anyone but the demo account. | A visitor can try the whole flow (connect, see listings, add them) without any eBay account, and without the app storing a third party's eBay tokens or showing the owner's listings. Separate paths rather than role checks inside the real routes: the demo account still cannot reach a single line of real eBay code. Connect and disconnect are free; an import request costs one change. |
| Change limit | `AdminUser.demoChangesUsed`, compared with `DEMO_CHANGE_LIMIT` (default 5). Every non-GET request by the demo account first takes one unit with a single conditional `UPDATE … WHERE demoChangesUsed < limit`; if the request ends with a status ≥ 400 the unit is given back. | One atomic statement, so parallel requests can't exceed the limit (tested with 12 at once). Refunding failures means a typo in a form doesn't cost the visitor a change. |
| Reset | At every successful demo sign-in: delete the account's sales and products (photos, listings, history cascade), recreate the sample items from `modules/demo/demo-data.ts`, set the counter to 0, then delete the removed photo files from storage. | No scheduler exists in this app (owner decision), and sign-in is the one moment a visitor expects a fresh start. It also bounds what the demo account can leave behind: at most 5 changes' worth of data and photos at any time. |
| Guard on destructive code | Every statement in `demo.service.ts` filters on `role = DEMO` in the database, and `reset` throws `NotDemoAccountError` for any other account. | Passing the wrong user ID by mistake must never be able to wipe the real inventory. |
| Provisioning | `syncDemoAccountFromConfig` at start: `DEMO_EMAIL` + `DEMO_PASSWORD` set → the account exists with exactly those (a change signs out demo sessions); unset → account and data are deleted. Invalid values switch the demo off and log why; they never stop the app. | The owner can hand out a password, rotate it, or end the demo by editing two variables. A demo setting should not be able to take production down. |
| Sample photos | Ten JPEGs (full + thumbnail) in `backend/assets/demo-photos`, read through `AppDeps.demoPhotos` (a file reader on Node, injected in `server.ts`). At each reset they are uploaded to photo storage under new keys *before* the transaction, and the previous files are deleted after it; a failed reset removes what it uploaded. The photo credit is appended to the item's description. | Sample photos then behave exactly like uploaded ones (same routes, same storage, a visitor can remove or reorder them), with no special case in the photo code. The photos are CC0, CC BY or CC BY-SA from Wikimedia Commons; BY and BY-SA require attribution, hence the credit next to each photo and `CREDITS.md`. A unit test checks that every sample item's files exist and fit the upload limits. |
| Sample IDs | Sample listings and orders use IDs starting with `DEMO-`. | Real eBay IDs are digits only. `EbayListing.ebayItemId` is globally unique, so a numeric sample ID could block the import of a real listing; and the future order sync matches sales by item ID. |

Known limits: one shared demo account, so two simultaneous visitors share the allowance and a second sign-in resets the first visitor's view. The eBay import and the future order sync must keep attributing eBay data to the administrator's account (today: `importListings(ownerId, …)` is only reachable by the administrator).

## Inventory rules implemented (Phase 2)

- Manual status changes go through `checkManualTransition` (`modules/products/product-status.ts`). Same-status changes are rejected (409). Leaving SOLD requires a reason (400 `REASON_REQUIRED`), because it overrides a recorded sale. Every change is written to `product_status_changes` in the same transaction, with source `MANUAL`.
- Status updates use compare-and-set (`UPDATE … WHERE id = ? AND status = <read value>`), so a concurrent change (e.g. a sale being processed in Phase 5) is never silently overwritten. The loser gets 409.
- Status can't be changed via `PATCH /products/:id`, only via the status endpoint, so it always lands in the history.
- New products start as AVAILABLE or RESERVED. SOLD comes only from a sale or a manual correction.
- Archive is a status change. Hard delete works only for products with no sales and no listing mapping (409 `PRODUCT_HAS_HISTORY` otherwise). The `sales.productId` foreign key is `RESTRICT` as a backstop.
- Money travels as decimal strings, never floats. The UI accepts "149,90" and normalises it to "149.90".

## PWA (installable app)

| Decision | Why |
|---|---|
| `vite-plugin-pwa` **1.3.0** (Workbox `generateSW`). 2.0 was skipped as a new major. | Standard Vite integration: generates the manifest and a precaching service worker from the build output. |
| Precache **only the app shell** (JS/CSS/HTML/icons). **No runtime caching rule at all**, so `/api` requests always hit the network. | PostgreSQL is the source of truth. A cached API response could show a sold item as available. The service worker cache holds no business data. |
| `navigateFallbackDenylist: [/^\/api\//]` | Full-page navigations to `/api/...` (the eBay OAuth callback in Phase 3) must reach the backend, not be answered with the cached `index.html`. Verified in the generated `sw.js`. |
| `registerType: "prompt"` and a "Reload" toast, hourly update checks | Installed apps stay open for days. Auto-reloading could discard a half-filled form. |
| Mutations use `networkMode: "always"` | Offline edits fail immediately and visibly instead of being queued and replayed later against data that may have changed. |
| Icons from one SVG via `@vite-pwa/assets-generator`; full-bleed background, glyph inside the maskable safe zone | One source of truth; no white borders on Android/iOS. |
| Service worker disabled in `vite dev` | Avoids stale-cache confusion while developing. Test the PWA with `vite build && vite preview`. |

**Known audit findings (accepted):** `npm audit` reports 2 low and 4 moderate findings in `deepmerge`, `glob` and `minimatch`. They come from `workbox-build`, which runs **only at build time** on the developer machine. It processes only our own config and build output and is **not part of the browser bundle**. The advisories need attacker-controlled input to that build step. `deepmerge` has no patched release, and npm's suggested "fix" is a downgrade of the plugin. Re-check when `vite-plugin-pwa`/Workbox ship updates.

**Also accepted (2026-11-20):** a high-severity ReDoS advisory in `effect` ≤ 3.22.0 (GHSA-7589-6fvf-x4pw), pulled in by `@prisma/config` 7.10.1, which pins `effect` 3.20.0. It is present in the production image, because the Prisma CLI runs `migrate deploy` on container start. The vulnerable code compiles a regex from schema input; the only input it ever receives here is our own `prisma.config.ts`, so no request can reach it. No patched Prisma 7 exists yet, and overriding a dependency pinned inside Prisma risks breaking migrations at deploy. Upgrade Prisma when a release ships a fixed `effect`.

## Product photos

Module: `backend/src/modules/images/`, storage in `backend/src/infrastructure/image-storage*.ts`.

| Concern | Decision | Why |
|---|---|---|
| Where files live | `ImageStorage` interface: S3-compatible bucket in production (`aws4fetch` 1.0.20: zero dependencies, signs requests for the built-in `fetch`, Workers-compatible), local folder in development, memory in tests | Standard S3 protocol, so Railway Buckets, Cloudflare R2 or AWS S3 are interchangeable. Development never touches real photos. |
| Resizing | In the browser (`frontend/src/lib/image-resize.ts`): canvas re-encode to JPEG, full ≤ 2048 px and thumbnail ≤ 600 px | No image library or heavy CPU work on the server; small uploads on mobile data; EXIF/GPS metadata is dropped by re-encoding. Verified in real Chrome (headless) with JPEG, PNG and WebP inputs. |
| Server validation | JPEG only, verified by parsing the frame header (`jpeg.ts`), which also yields the dimensions; 5 MB / 4096 px limits; whole request capped by `bodyLimit`; 24 per product, re-checked inside the insert transaction | The client is not trusted: a renamed file or a script can't be stored as an "image". |
| Keys | `products/<productId>/<imageId>.jpg` and `…_thumb.jpg`, with a server-generated UUID; keys validated against a strict pattern | Unguessable, never derived from user input, no path traversal. |
| Serving | `GET /images/:id` and `/images/:id/thumb` behind the session guard, streamed from storage with `Cache-Control: private, max-age=31536000, immutable` | Photos stay private, and each is downloaded once per device (a new upload gets a new ID). The bucket itself is never public. |
| Consistency | Objects are written first, then the row; on failure the objects are removed. Deleting removes the row first, then the objects; a failed object delete only leaves an orphan and is logged. | A row never points at a missing file. |
| Ordering | `position` column; `PUT /products/:id/images/order` must list every photo exactly once; the first is the main photo | One endpoint covers "make main" and any later drag-to-reorder. |
| Production safety | Config refuses to start in production without `S3_*` (or an explicit `IMAGE_STORAGE=local`) | A container disk is wiped on every deploy; silent fallback would lose photos. |

Not done: automatic bucket backups (Railway has none), a bulk "export all photos" function, drag-to-reorder UI.

## eBay connection (Phase 3)

Module: `backend/src/modules/ebay/`. Tested against a scripted fake token endpoint (`tests/support/fake-ebay.ts`). Connected to a real seller account on eBay production on 2026-11-21.

| Concern | Decision |
|---|---|
| Flow | `GET /integrations/ebay/connect` (browser navigation) → 302 to eBay consent → eBay → `GET /integrations/ebay/callback` → 302 to `/settings/ebay?connected=1` or `?error=<code>`. Redirects are relative, so they stay on whatever origin the app is served from (localhost, tunnel, deployment). |
| CSRF on the OAuth flow | Random 256-bit `state`, single-use (atomic compare-and-set), 10-minute expiry, and **bound to the admin session** that started it (`oauth_states.adminSessionId`). A state from another session, a replay or an expired state are all rejected before eBay is contacted. |
| Session on navigations | connect/callback bypass the JSON auth guard and check the session themselves. A logged-out browser is redirected to `/login?next=…` instead of seeing a JSON 401. |
| Token storage | Refresh and access tokens are AES-256-GCM encrypted (Web Crypto, `infrastructure/token-cipher.ts`, versioned `v1.<iv>.<ct>` format) in `ebay_accounts`. They never appear in API responses or logs. The OAuth code/state are never logged. |
| Access token use | `getAccessToken()` (server-side only) reuses the cached token until 5 minutes before expiry, then refreshes. Concurrent callers share one refresh request. |
| Refresh failures | `invalid_grant` → account set to `REAUTH_REQUIRED`, access token cleared, dashboard error. Network/timeout/429/5xx → retried twice with exponential backoff, then "eBay unavailable" (no state change). An undecryptable stored token (key changed) → `REAUTH_REQUIRED` with an explanatory message. |
| Disconnect | Clears all tokens and pending states. Products, listing links and sales are kept. No programmatic revocation (none confirmed); the UI tells the seller to also remove the app on eBay. |
| Expiry warning | Dashboard warns 30 days before the refresh token (~18 months) expires. |

**Verified vs. unconfirmed.** developer.ebay.com returned HTTP 403 to automated fetching, so facts were taken from **eBay's official OAuth clients** (github.com/eBay/ebay-oauth-nodejs-client, -python-client, -java-client).
- *Confirmed* there: consent and token endpoints (sandbox/production); `POST` with `application/x-www-form-urlencoded` and `Authorization: Basic base64(client_id:client_secret)`; body fields for both grants (refresh sends `scope`); response fields `access_token`, `expires_in`, `refresh_token`, `refresh_token_expires_in`, `token_type`; non-200 errors with `error`/`error_description`; scope strings `…/oauth/api_scope` and `…/api_scope/sell.fulfillment`.
- *Not confirmed:*
  - `invalid_grant` for revoked tokens. Assumed from the OAuth 2.0 standard (RFC 6749 §5.2).
  - Whether refresh rotates the refresh token. Handled either way.
  - The exact decline-redirect parameters. Any callback without a code is treated as declined.
  - Whether a `.readonly` fulfillment scope exists. Scopes are configurable via `EBAY_SCOPES`.
  - The HTTPS/localhost rule for RuName URLs.
  - The Commerce Identity API. Not called, so the seller username stays empty until Phase 4.

## eBay listing import (2026-11-21)

`ebay-trading.client.ts` reads the seller's active listings with the Trading API call `GetMyeBaySelling` (the Inventory API cannot see listings made on the eBay site). `ebay-listings.service.ts` turns them into products; `ebay-listings.routes.ts` exposes `GET /integrations/ebay/listings` and `POST /integrations/ebay/listings/import`.

- **Read-only toward eBay.** No call here changes a listing.
- **Live, not stored.** The list is fetched from eBay on request (page open, manual refresh, import). Only imported listings get an `EbayListing` row.
- **Import = one product per listing**, created together with its `EbayListing` link and a status-history entry (source `IMPORT`) in one transaction. Title, price, currency and picture always come from eBay's answer, never from the browser, which sends item IDs only. The unique `ebayItemId` makes repeats and parallel imports harmless (skipped as `ALREADY_IMPORTED`). A listing without a usable price is skipped.
- **Pictures.** `EbayListing.imageUrl` holds eBay's own picture address. The frontend shows it until the product has uploaded photos, so no image bytes are copied. The browser loads it straight from eBay's image host (`referrerPolicy="no-referrer"`). eBay reports a small preview; the frontend asks for a larger size by changing the `s-l<N>` marker in the address and falls back to the original if that fails (`frontend/src/lib/ebay-image.ts`). That marker is an observed convention, not a documented one.
- **XML.** The Trading API answers in XML. `common/xml.ts` is a ~100-line reader for plain element trees (no DOCTYPE, so no entity expansion) instead of a parser dependency.
- **Errors.** eBay failures map to `409 EBAY_NOT_CONNECTED` / `EBAY_REAUTH_REQUIRED`, `502 EBAY_REJECTED` (with eBay's own short message) and `503 EBAY_UNAVAILABLE` (after 2 retries).
- **Not built:** linking a listing to an already existing product; refreshing a linked listing's stored title/picture; marking listings ended (that belongs to sale sync).

*First real run (2026-11-21, eBay production, EBAY_DE):* the listing call succeeded with compatibility level `1349` and the OAuth scopes in use, and all 14 active listings were imported as products.

*Still not confirmed (developer.ebay.com is not fetchable; written from memory):*
  - Which fields `GetMyeBaySelling` returns by default in every case. Every field except `ItemID` is treated as optional.
  - The site IDs of marketplaces other than EBAY_DE.
  - The error codes treated as "token not accepted" (931, 932, 16110, 17470, 21916984, 21917053). Any other failure is shown with eBay's message.

## Security baseline (Phase 1)

- CORS allows only `FRONTEND_URL`, with credentials. In development the Vite proxy makes requests same-origin anyway.
- Hono `secureHeaders` on all responses. Every response carries a request ID.
- Config validation errors name the variable, never the value.
- The logger redacts keys that look like secrets (`token`, `secret`, `password`, `authorization`, `cookie`, `signature`, …). The access log never records bodies or headers.
- `/health` reports dependency status but not error details.
- Swagger/OpenAPI is disabled when `NODE_ENV=production` (until it can sit behind the admin session).
- Postgres is bound to `127.0.0.1` only.

## eBay integration: verified facts and open questions

Checked against developer.ebay.com on 2026-11-08. Several pages didn't render fully, so anything not confirmed is marked as such. Each item is verified before the phase that depends on it.

**Confirmed**

- The **Inventory API** doesn't list listings created in Seller Hub or with the Trading API. They would first have to be migrated (`bulkMigrateListing`), after which they can no longer be edited in Seller Hub. **We will not migrate** (per the spec).
- The **Trading API `GetMyeBaySelling`** (`ActiveList`) returns the seller's active listings with `ItemID`, `Title`, `SKU` and price. It paginates (`EntriesPerPage`, max 200, plus `PageNumber`), is limited to 25,000 items, and is rate-limited to 300 calls per 15 seconds per seller. It accepts an **OAuth user access token** through the `X-EBAY-API-IAF-TOKEN` header (XML over `https://api.ebay.com/ws/api.dll`). → Used by the listing import (see “eBay listing import”).

**Scope decision (owner, 2026-11-11):** no notifications/webhooks (spec Phase 6), no scheduled sync and no UI polling (spec Phase 7). Turnover is low, so sale status is synced from eBay's Fulfillment API **when the app is opened and on manual refresh** (throttled server-side). This needs no scheduler, which also simplifies deployment. Pushing items to eBay is a later stage.

**Open, to verify before the dependent phase**

1. ~~Notification topic `ORDER_CONFIRMATION`~~ and 2. ~~`X-EBAY-SIGNATURE` verification~~: out of scope (no webhooks).
3. **Fulfillment `getOrders` details**: the `lastmodifieddate` filter syntax, page-size maximum, lookback window, and exact field names (`legacyItemId`, `lineItemCost`, `cancelStatus`, …). (Phase 5) The doc page returned HTTP 403 to our fetcher. To verify from eBay's OpenAPI spec or the API Explorer.
4. **OAuth scopes** needed for Fulfillment (`sell.fulfillment` read), Trading calls and Notification subscriptions. (Phase 3)
5. ~~Marketplace account deletion notifications~~: handled, see below.

### Marketplace account deletion endpoint (2026-11-21)

eBay keeps a **production** keyset disabled until the application subscribes to "Marketplace account deletion" notices or declares an exemption. We subscribe, with `GET`/`POST /api/v1/webhooks/ebay/account-deletion` (`ebay-account-deletion.routes.ts`), rather than sign an exemption whose exact wording could not be checked.

- The app stores **nothing about other eBay users**: no buyer names, addresses or user IDs (a `Sale` holds order ID, item ID, price and dates). So a notice never has anything to delete. It is answered with `204` and dropped: the body is not read, stored or logged.
- Because no action follows from a notice, `X-EBAY-SIGNATURE` is **not verified**. A forged notice changes nothing. **If buyer data is ever stored, this handler must verify the signature and delete that user's data.**
- This is the only route under `/webhooks/`, and the only one besides `/health` and the login/OAuth routes that works without a session. It is off (404) unless `EBAY_VERIFICATION_TOKEN` is set.
- Protocol, confirmed from eBay's official SDK (`github.com/eBay/event-notification-nodejs-sdk`): validation is `GET ?challenge_code=…` answered with `200 {"challengeResponse": hex(sha256(challengeCode + verificationToken + endpointUrl))}`. Notices are `POST`ed and acknowledged with `204`. The endpoint URL in the hash is derived from `FRONTEND_URL` and must equal the address entered in the portal exactly.
- *Unconfirmed (from memory, the docs page is not fetchable):* the verification token must be 32–80 characters of letters, digits, `_` and `-`. Tokens are generated to fit that.
- This is not the sale-notification feature of spec Phase 6, which stays out of scope.
