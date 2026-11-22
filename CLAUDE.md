# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A private inventory app for a seller of one-of-a-kind items, with eBay integration. One owner uses it, mostly on a phone. `README.md` has the purpose and design, `docs/architecture.md` the decisions and their reasons, `docs/development.md` setup, deployment and troubleshooting.

## Commands

npm workspaces: `backend` and `frontend`. Run `npm install` only at the repo root (`npm install -w backend` prunes the frontend's dev packages).

```bash
npm run db:up                       # PostgreSQL in Docker (needed for dev and integration tests)
npm run dev:backend                 # API on :3000
npm run dev:frontend                # web app on :5173, proxies /api to the backend

npm run typecheck                   # both workspaces
npm test                            # both workspaces
npm run build                       # both workspaces

npm run test:unit -w backend        # no database needed
npm run test:integration -w backend # real PostgreSQL; files run one at a time
cd backend  && npx vitest run tests/integration/demo.test.ts   # one file
cd backend  && npx vitest run -t "allows five changes"         # by test name
cd frontend && npx vitest run src/test/demo.test.tsx
```

There is no linter or formatter; match the surrounding code (about 120 columns).

Integration tests use `TEST_DATABASE_URL`, truncate every table, and refuse to run unless the database name ends in `_test`. Migrations are applied to it automatically.

### Database changes

`prisma migrate dev` needs an interactive terminal, so migrations are written by hand:

```bash
cd backend
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script   # shows the SQL
# put it in prisma/migrations/<YYYYMMDDHHMMSS>_<name>/migration.sql (add backfills by hand), then:
npx prisma migrate deploy && npx prisma generate
```

The production container runs `prisma migrate deploy` on every start, so a migration must work on existing data.

## Architecture

Production is one container: the backend serves the API and the built frontend. PostgreSQL is the source of truth; photos live in an S3-compatible bucket; only the backend talks to eBay.

### Backend (`backend/src`)

- `app.ts` builds the Hono app from injected dependencies (`AppDeps` in `common/router.ts`: config, database, logger, clock, `fetch`, photo storage). It uses Web APIs only. Everything Node-specific (listener, file access, reading `process.env`) belongs in `server.ts` or `infrastructure/`.
- Each folder in `modules/` holds routes (`createRoute` from zod-openapi), a service, and schemas. Services throw `AppError`; `app.ts` turns it into the `{ error: { code, message } }` envelope. Success is `{ data }` or `{ data, meta }`.
- Middleware order in `app.ts` is the security model: rate limit, CSRF (`X-Requested-With` on every non-GET), `requireAdmin`, then `demoRestrictions`.

Rules that span files and are easy to break:

- **Routes are private by default.** A route is public only if listed in `PUBLIC_PATHS` in `app.ts`.
- **Every product query is filtered by owner.** Service methods take the signed-in account's ID as their first argument and put it in the database filter. Another account's item answers 404, never 403. Photos, listings, sales and history belong to an account through their product.
- **The demo account (`role = DEMO`) reaches only the prefixes in `DEMO_ALLOWED_PREFIXES`** (`modules/demo/demo.middleware.ts`). A new module is closed to it until listed there. Its non-GET requests count against a change limit. It never reaches `modules/ebay` routes; it has a simulated eBay under `/demo/ebay` that feeds sample listings into the real listing import.
- **Code that deletes or resets demo data filters on `role = DEMO` in the query itself**, so a wrong user ID can never touch the owner's inventory.
- **Tests never call eBay.** `AppDeps.fetch` is replaced by the scripted fake in `tests/support/fake-ebay.ts`.
- **Sample eBay IDs start with `DEMO-`.** Real IDs are digits only, and `EbayListing.ebayItemId` is globally unique.

### Frontend (`frontend/src`)

Pages use hooks (TanStack Query), hooks call `services/`, services call `lib/api-client.ts`. Queries never go stale on their own (`staleTime: Infinity`, no polling, no refetch on focus): data loads on open, after the user's own changes (mutations invalidate), and on manual refresh. Tests render the real route tree with `renderRoute` and a fake API from `mockApi` (`src/test/render.tsx`).

## Decisions already made by the owner

Do not reintroduce these without being asked:

- No eBay webhooks, no scheduler, no background jobs, no polling.
- No SKU. An item is matched to eBay only by the eBay item ID.
- eBay is read-only so far. Sale detection (on open and manual refresh) and pushing listings to eBay are not built.
- eBay pictures are stored as addresses, not copied into the bucket.

## Working in this repository

- **The repository is public.** Keep out of every commit: secrets, the live app's address, hosting project or bucket identifiers, login details, personal email addresses and local paths. Run the `publish-check` skill before committing.
- Commit, push and deploy only when asked. Deploying follows the `deploy` skill (checks, a local Docker rehearsal, then the live verification).
- Project skills in `.claude/skills/`: `backend-feature`, `frontend-feature`, `run-app`, `deploy`, `publish-check`.
- Facts about eBay's API that could not be checked against eBay's documentation are marked as unconfirmed in `docs/architecture.md`. Keep marking them, and never present an untested eBay call as working.
- When behaviour or a design decision changes, update `docs/architecture.md`; keep `README.md` short.
