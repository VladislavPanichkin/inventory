# Development, setup and operations

How to run, configure, deploy and troubleshoot the app. For what it is and how it is designed, see the [README](../README.md) and [architecture.md](architecture.md).

## Stack

| Layer    | Tech |
|----------|------|
| Frontend | React 19, TypeScript, Vite 7, Tailwind CSS 4, shadcn/ui, TanStack Query 5, React Router 7 |
| Backend  | Node.js (≥22), TypeScript, Hono 4 (+ zod-openapi), Zod 4 |
| Database | PostgreSQL 17 via Prisma 7 (driver adapter `@prisma/adapter-pg`) |
| Tests    | Vitest 4, Testing Library, jsdom |

## Repository layout

```text
.
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma          # all models (Product, EbayListing, Sale, ...)
│   │   ├── migrations/            # SQL migrations (committed)
│   │   └── seed.ts                # idempotent demo data
│   ├── prisma.config.ts           # Prisma 7 config (schema, migrations, seed, DB URL)
│   ├── src/
│   │   ├── app.ts                 # Hono app factory: runtime-agnostic (Web APIs only)
│   │   ├── server.ts              # Node entry point (listener, signals): Node-specific
│   │   ├── config/env.ts          # Zod-validated configuration
│   │   ├── common/                # errors, response envelopes, logger, router factory
│   │   ├── infrastructure/        # database connection (swap point for Workers/Supabase)
│   │   ├── modules/               # one folder per module: authentication, products, images, sales, dashboard, ebay, demo, health
│   │   └── generated/prisma/      # generated Prisma client (gitignored)
│   └── tests/{unit,integration}/
├── frontend/
│   └── src/
│       ├── components/{ui,layout}/  # shadcn/ui components + app shell
│       ├── pages/  hooks/  services/  lib/
│       └── test/
├── docker/postgres-init/          # creates the inventory_test database
├── docker-compose.yml             # local PostgreSQL only
└── docs/                          # architecture.md (design notes), development.md (this file)
```

Frontend folders live under `frontend/src/` (Vite convention) rather than directly in `frontend/`.

## Prerequisites

- Node.js **22.9+** (developed on 24). The scripts use `--env-file-if-exists`.
- Docker (Docker Desktop on macOS) for PostgreSQL.

## First-time setup

```bash
# 1. Install dependencies (both workspaces). The root package.json allow-lists the
#    install scripts for prisma, @prisma/engines and esbuild (npm 11+ blocks others).
npm install

# 2. Configure the backend
cp backend/.env.example backend/.env
#    then set TOKEN_ENCRYPTION_KEY:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# 3. Start PostgreSQL (container "inventory-postgres", bound to 127.0.0.1:5432)
npm run db:up

# 4. Create tables and load demo data
npm run db:deploy -w backend     # apply committed migrations
npm run db:seed -w backend       # 10 demo products + the admin from ADMIN_EMAIL/ADMIN_PASSWORD (safe to re-run)
```

### Administrator account

There is exactly one administrator. The seed creates it from `ADMIN_EMAIL`/`ADMIN_PASSWORD` in `backend/.env` if none exists yet, and it never overwrites an existing one.
In development the default login is **admin@example.com / change-me-please**.

To set or change the email and password (any environment; this also logs out every session):

```bash
ADMIN_PASSWORD='a-long-passphrase' npm run admin:set-password -w backend -- --email you@example.com
```

The password comes from the environment, never from command-line arguments, which can leak into shell history. Minimum length is 12 characters.

### Demo account (optional)

A second, restricted login for showing the app to someone else, for example a potential employer. It is off unless you set it up.

| | Administrator | Demo account |
|---|---|---|
| Items | Your real inventory | Its own 10 sample items with photos. Your items are invisible to it |
| eBay | Connects and imports | A **simulated eBay**: a sample seller account with 8 sample listings that the visitor can connect and add to the demo inventory. The real eBay routes refuse the demo account, and nothing reaches eBay |
| Changes | Unlimited | **5 per sign-in** (create, edit, status change, photo upload/removal/reorder, delete, adding sample listings). A failed request doesn't count; connecting the sample eBay account is free |
| Reset | Never | Sample items and the 5 changes are restored at every demo sign-in; anything the visitor added or uploaded is deleted, and the sample eBay account is disconnected again |

**Switch it on:** set `DEMO_EMAIL` and `DEMO_PASSWORD` (at least 12 characters, and not the administrator's email), then restart. On Railway these are two variables on the `inventory-app` service. `DEMO_CHANGE_LIMIT` (default 5) changes the allowance.

**Change the password:** change `DEMO_PASSWORD` and restart. Every demo session is signed out.

**Switch it off:** remove both variables and restart. The demo account, its items, photos and sessions are deleted. Your own data is never part of this.

Things to know:

- Everyone who has the demo password shares one account. If two people use it at the same time, the second sign-in restores the sample data under the first.
- The sample items carry eBay item and order IDs starting with `DEMO-`. Real eBay IDs are digits only, so sample data can never be mistaken for, or block, a real listing or sale.
- An invalid setting (password too short, the administrator's email) never stops the app: the demo account stays off and the reason is in the log.
- The sample photos are in `backend/assets/demo-photos` (about 2 MB). They are freely licensed photos from Wikimedia Commons; authors, licenses and sources are in `CREDITS.md` in that folder, and each item's description shows its photo credit. To change the sample items or photos, edit `backend/src/modules/demo/demo-data.ts`.

## Running locally

Use two terminals:

```bash
npm run dev:backend     # http://localhost:3000  (API under /api/v1)
npm run dev:frontend    # http://localhost:5173  (proxies /api to the backend)
```

- Admin UI: http://localhost:5173
- Health: http://localhost:3000/api/v1/health
- API docs (Swagger UI, non-production only): http://localhost:3000/api/v1/docs
- OpenAPI JSON: http://localhost:3000/api/v1/openapi.json

## Installable app (PWA)

The admin UI is a Progressive Web App: it can be installed on a phone or desktop and opens full-screen like a native app.

- **What is cached:** only the app itself (code, styles, icons), so it starts instantly. **Business data is never cached.** Products and sales always come live from the server, so the app can't show a stale status (e.g. an item that has already sold).
- **Refreshing:** no background polling. Data loads when the app opens, after your own changes (create/edit/status/delete), and when you refresh manually: **pull down** on the page (touch) or press the **refresh button** in the header. The installed app has no browser pull-to-refresh, so the app provides its own. From Phase 5, opening the app and refreshing also sync sale status from eBay.
- **Offline:** a banner says you're offline. Data on screen is whatever was last loaded, and changes fail immediately with an error instead of being queued.
- **Updates:** when a new version is deployed, the app shows "A new version is available → Reload". It never reloads by itself.
- **The service worker only runs in production builds.** In `npm run dev` it's disabled, so development behaves like a normal website. To test the PWA locally:
  ```bash
  npm run build -w frontend && npm run preview -w frontend   # http://localhost:4173 (proxies /api)
  ```
  In desktop Chrome, an install icon then appears in the address bar.
- **Installing on a phone needs HTTPS.** Browsers only allow installation from `https://` (or `localhost`), so `http://<your-mac's-IP>:4173` over Wi-Fi won't be installable. Use an HTTPS tunnel or a deployed instance.
- **iPhone:** open the site in Safari → Share → *Add to Home Screen*. The installed app keeps its own login, so you sign in once inside the app.
- **Icons:** generated from `frontend/public/icon.svg`. After changing it, run `npm run pwa:icons -w frontend`.

## Connecting eBay (sandbox first)

> **Status:** the connect flow is built and tested against simulated eBay responses only. It has **not yet been run against eBay itself**.

Once your eBay Developer Program account is approved:

1. **Keyset.** In the developer portal → *Application Keys*, create a **Sandbox** keyset. Note the **App ID (Client ID)** and **Cert ID (Client Secret)**.
2. **Test seller.** Create a **Sandbox test user** (*User Tokens / Sandbox users*). That's the seller account you'll log in with.
3. **RuName (redirect).** Under *User Tokens* → *Get a Token from eBay via Your Application*, add an eBay **Redirect URL name (RuName)**. Set:
   - *Your auth accepted URL*: `<app origin>/api/v1/integrations/ebay/callback`
   - *Your auth declined URL*: the same address

   `<app origin>` is the address you open the app at, e.g. `http://localhost:5173` in development. *Unconfirmed:* whether eBay accepts a plain `http://localhost` URL here. If it insists on HTTPS, use an HTTPS tunnel and put the tunnel's address here.
4. **Configure** `backend/.env`:
   ```bash
   EBAY_ENVIRONMENT=sandbox
   EBAY_CLIENT_ID=<App ID>
   EBAY_CLIENT_SECRET=<Cert ID>
   EBAY_RU_NAME=<the RuName string, e.g. Your_Name-YourApp-SBX-abcdef>   # the *name*, not the URL
   ```
   `TOKEN_ENCRYPTION_KEY` is already set. Restart the backend.
5. In the app, go to **eBay → Connect eBay account**, log in with the sandbox test user and click *Agree*. You land back on the eBay page showing **Connected**.

### Production keyset

eBay keeps a production keyset disabled until "Marketplace account deletion" is set up. On the keyset's *Notifications* page (*Alerts & Notifications*):

1. Enter an alert email address and save.
2. *Notification endpoint URL*: `<app origin>/api/v1/webhooks/ebay/account-deletion` (must match `FRONTEND_URL` exactly, HTTPS).
3. *Verification token*: the value of `EBAY_VERIFICATION_TOKEN` (random, 32–80 characters of letters, digits, `_`, `-`). It must already be deployed, because eBay calls the endpoint as soon as you save.

Then create a **production** RuName as in step 3 above, and set `EBAY_ENVIRONMENT=production` with the production App ID, Cert ID and RuName. Sandbox and production are separate: reconnect the eBay account after switching.

### Importing your listings

Once connected, the eBay page shows **Your eBay listings**: the account's active listings, read live from eBay when the page opens and on a manual refresh. **Add** (or **Add all**) creates a product per listing with its title, price and eBay's picture, linked to the listing. Repeating it is safe: listings already in the inventory are skipped. Nothing is changed on eBay. A product shows eBay's picture until you upload photos of your own. Products created this way can be archived but not deleted (they carry a listing link).

If something fails, the eBay page shows the reason (declined, expired link, eBay unavailable, credentials rejected…). Tokens are stored encrypted (AES-256-GCM) and never sent to the browser. **Disconnect** makes the app forget them. To fully revoke access, also remove the app in your eBay account settings.

## Product photos

Each product can have up to **24 photos** (eBay's per-listing maximum). The first is the main photo shown on the product card.

- **Adding:** open a product → **Add photos**. On a phone this offers the camera or the photo library; several can be chosen at once.
- **On the device, before upload:** each photo is resized to a full version (longest side ≤ 2048 px) and a thumbnail (≤ 600 px), both JPEG. Re-encoding removes embedded metadata, including **GPS location**. A 6 MB phone photo becomes roughly 0.5 MB.
- **On the server:** only real JPEGs are accepted (the bytes are checked, not the file name), max 5 MB and 4096 px per side. Files are stored privately under random keys and are **only served to a logged-in session**.
- **Managing:** on the product page, tap a thumbnail to view it, **Make main** to put it first, **Delete photo** to remove it. Deleting a product deletes its photos; archiving keeps them.
- **Storage:** production uses an S3-compatible bucket (`S3_*` settings; on Railway: bucket `inventory-photos`, EU West). Development uses the local folder `backend/.data/images`. Production refuses to start without storage configured, because a container's own disk is wiped on every deploy.
- **Backups:** Railway Buckets have **no automatic backups**; a deleted bucket can be restored for 52 hours.
- **Check the bucket connection** (uploads, reads back and deletes one tiny test object):
  ```bash
  railway run --service inventory-app -- npm run storage:check -w backend
  ```

## Deployment (Railway)

Production runs on Railway as **one service** (`inventory-app`: the API plus the built web app, from the `Dockerfile`), with a managed **Postgres** and the **`inventory-photos`** bucket, all in EU West.

- **Deploy the current folder:**
  ```bash
  npm run railway:deploy          # = railway up --service inventory-app --detach -y
  railway deployment list --service inventory-app
  ```
  The container applies pending database migrations on every start, then serves the app. Railway only switches over once `/api/v1/health` answers.
- **Rehearse first** (this caught a startup crash the tests could not): `docker build -t inventory:local .`, then run it against an empty local database with `IMAGE_STORAGE=local`.
- **Service settings live in `.railway/railway.ts`** (Railway "Infrastructure as Code"; it replaced `railway.json`, which Railway stops reading on 2026-12-01). It declares the Dockerfile build, the health check and the region for `inventory-app` only:
  - It's a *named partial*, so it never touches resources it doesn't declare (the database and the bucket).
  - Variables are **unmanaged**: secrets stay in Railway and never appear in the repo.
  - Railway does **not** read this file during deploys. After editing it, preview and apply:
    ```bash
    npm run railway:plan            # read-only preview; check for unexpected changes
    railway config apply            # applies; destructive changes need --confirm-destructive
    ```
- **Settings and secrets** are Railway variables on the service (`railway variable list --service inventory-app`). Edits made in the dashboard are *staged* until you press **Apply changes**.
- **Region gotcha:** `railway service scale <svc> eu-west=1` *adds* a region. The default one is called `iad`, so also pass `iad=0`; the plan allows a single region.

## Tests

```bash
npm test                                  # everything (backend unit + integration, frontend)
npm run test:unit -w backend              # no database needed
npm run test:integration -w backend       # needs Postgres running; uses inventory_test
npm test -w frontend
npm run typecheck                         # both workspaces
npm run build                             # both workspaces
```

Integration tests apply migrations to `TEST_DATABASE_URL` and truncate its tables between tests. As a safety check they **refuse to run unless the database name ends in `_test`**.

## Useful scripts (backend)

| Script | Purpose |
|---|---|
| `npm run db:migrate -w backend` | Create and apply a new migration after editing `schema.prisma` (dev only) |
| `npm run db:deploy -w backend`  | Apply committed migrations |
| `npm run db:seed -w backend`    | Load demo data (refuses in production) |
| `npm run db:reset -w backend`   | **Drops all data** in the dev DB, re-applies migrations, re-seeds |
| `npm run db:studio -w backend`  | Prisma Studio |

## API

| Endpoint | Purpose |
|---|---|
| `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | Session authentication |
| `GET /products` | List: `page`, `pageSize` (≤100), `search` (name, or exact eBay item ID), `status` (`AVAILABLE,SOLD`… or `ALL`; default hides ARCHIVED), `sort` (`name`/`price`/`createdAt`/`updatedAt`), `order` |
| `GET/PATCH/DELETE /products/:id`, `POST /products` | CRUD. DELETE only works for products without eBay sales or a listing (otherwise 409, so archive instead) |
| `PATCH /products/:id/status` | Manual status change `{status, reason?}`. A reason is required when leaving SOLD |
| `GET /products/:id/status-history`, `GET /products/:id/sales` | Product history |
| `POST /products/:id/images` (multipart `image` + `thumbnail`), `DELETE /products/:id/images/:imageId`, `PUT /products/:id/images/order` | Upload, delete and reorder photos (first = main) |
| `GET /images/:id`, `GET /images/:id/thumb` | Photo bytes (session required) |
| `GET /sales`, `GET /sales/:id` | Sales (read-only; created by order sync in Phase 5) |
| `GET /dashboard/summary` | Counts, recent sales, eBay/sync health, warnings |
| `GET /integrations/ebay`, `GET …/connect`, `GET …/callback`, `POST …/disconnect` | eBay connection status and OAuth round trip |
| `GET /integrations/ebay/listings` | The connected seller's active listings, read live from eBay, each marked with its product if already imported |
| `POST /integrations/ebay/listings/import` | Create products from listings. Body `{itemIds?: string[]}`; without it, every active listing not yet imported. Read-only toward eBay |
| `GET /health` | Public liveness check |
| `GET/POST /webhooks/ebay/account-deletion` | Called by eBay (production keyset requirement). Answers eBay's validation challenge and acknowledges deletion notices. Stores nothing. Off unless `EBAY_VERIFICATION_TOKEN` is set |

Full schema: Swagger UI at `/api/v1/docs` (development only).

### Conventions

- Base path `/api/v1`. Every route requires the admin session **except** `/health`, `/auth/login`, `/auth/logout`, the eBay connect/callback redirects (they check the session themselves) and `/webhooks/ebay/account-deletion`, which eBay calls and which only acknowledges.
- Mutating requests (POST/PATCH/DELETE) must send `X-Requested-With` (CSRF guard). The frontend does this automatically.
- Rate limits: 600 requests/min per client IP overall; 10 login attempts per 15 min.
- Every product, photo and sale belongs to the signed-in account. Another account's item answers `404`, never `403`.
- The demo account gets `403 DEMO_NOT_AVAILABLE` outside products, photos, sales, the dashboard and its simulated eBay (`/demo/ebay/*`, which answers `404` to the administrator), and `403 DEMO_LIMIT_REACHED` once its changes are used up. `GET /auth/me` reports `role` and, for the demo account, `demo: { changesUsed, changesLimit }`.
- Success: `{ "data": ... }`, or `{ "data": [...], "meta": { page, pageSize, total, totalPages } }` for lists.
- Error: `{ "error": { "code", "message", "details"?, "requestId" } }` with an appropriate HTTP status.
- Validation failures: `400 VALIDATION_ERROR` with per-field details.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Cannot connect to the Docker daemon` | Start Docker Desktop, then `npm run db:up`. |
| Port 5432 already in use | Set `POSTGRES_PORT=5433` when running compose and update both URLs in `backend/.env`. |
| `Invalid configuration: DATABASE_URL ...` on startup | `backend/.env` is missing; copy it from `.env.example`. |
| `Cannot find module '../generated/prisma/client.js'` | Run `npm run prisma:generate -w backend`. |
| Integration tests: `TEST_DATABASE_URL is not set` / database missing | The test DB is created on the container's first start. With an older volume, run `docker exec inventory-postgres createdb -U inventory inventory_test`. |
| UI shows "Server unreachable" | The backend isn't running on :3000 (or set `BACKEND_URL` for the Vite proxy). |
| Can't log in / forgot password | `ADMIN_PASSWORD='…' npm run admin:set-password -w backend -- --email you@example.com` |
| `429 RATE_LIMITED` on login | 10 attempts per 15 minutes per IP. Wait, or restart the backend in development (limits are in-memory). |
| `403 CSRF_REJECTED` calling the API from curl/scripts | Add `-H 'X-Requested-With: fetch'` to POST/PATCH/DELETE requests. |

## Roadmap

1. ✅ Foundation
2. ✅ Inventory management + admin authentication (+ installable PWA)
3. ✅ eBay connection (OAuth). Tested with simulated eBay and connected to a real seller account in production (2026-11-21)
4. ✅ Deployment (Railway) and product photo upload
5. ✅ Import active eBay listings as products (eBay page → *Your eBay listings*). Tested with simulated eBay and run against eBay itself (2026-11-21). Linking a listing to an *existing* product is not built
6. Sale sync from eBay orders, **on app open and manual refresh** (no scheduler)
7. Push items to eBay (create/end listings from the app)

Also built: an optional **demo account** with its own sample items, no eBay access and 5 changes per sign-in (see *Demo account*).

Out of scope for now (owner decision): eBay notifications/webhooks, scheduled sync, live UI updates.
