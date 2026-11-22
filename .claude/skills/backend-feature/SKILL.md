---
name: backend-feature
description: Checklist for adding or changing anything in the backend of this repo - an API route, a service, a database table or column, or an eBay call. Use it whenever work touches backend/src or backend/prisma, even for a small change, because the security rules here (owner filter, private-by-default routes, demo allow-list) are spread over several files and easy to miss.
---

# Backend feature

The backend is a Hono app assembled in `backend/src/app.ts` from modules in `backend/src/modules/`. Read `CLAUDE.md` first if you have not; this skill is the working order for a change.

## 1. Data model (only if it changes)

Edit `backend/prisma/schema.prisma`, then write the migration by hand, because `prisma migrate dev` needs an interactive terminal:

```bash
cd backend
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script 2>/dev/null
```

Put the SQL in `prisma/migrations/<YYYYMMDDHHMMSS>_<name>/migration.sql`, then `npx prisma migrate deploy && npx prisma generate`.

Production applies migrations on every start against real data. A new required column therefore needs three steps in the same file: add it as optional, fill existing rows, then make it required. See `20261121180000_demo_account` for the pattern, including a clear error when the backfill cannot work.

## 2. Route

- Define it with `createRoute` and register it with `router.openapi` in the module's `*.routes.ts`. A new module is mounted in `app.ts`.
- It is private automatically. Make it public only by adding its path to `PUBLIC_PATHS` in `app.ts`, and only when it truly must work without a session.
- Responses are `{ data }` or `{ data, meta }`. Failures are thrown as `AppError(status, CODE, message)` from the service.

## 3. Service

- Every method takes the signed-in account's ID as its first argument (`c.get("admin").id` in the route) and puts it into the database filter itself: `where: { id, ownerId }`, or `product: { ownerId }` for rows that belong to a product. Do not load a row and check the owner afterwards.
- Something that belongs to another account is `notFound(...)`, never a 403, so IDs cannot be probed.
- Reach the outside world only through `AppDeps`: `deps.fetch` for HTTP, `nowFrom(deps)` for the time, `deps.imageStorage` for files. That is what lets tests run without network or clock. Node-only code goes in `server.ts` or `infrastructure/`.

## 4. Decide what the demo account may do

The demo account (`role = DEMO`) can only reach path prefixes listed in `DEMO_ALLOWED_PREFIXES` (`modules/demo/demo.middleware.ts`).

- A route under an existing allowed prefix (for example `/products/...`) is open to the demo account. Its non-GET requests use up the demo change limit; that is usually what you want.
- A new prefix is closed to it. Add it to the list only on purpose.
- The demo account must never reach `modules/ebay`. If the feature needs a demo equivalent, build it under `/demo/` the way `demo-ebay.*` does.
- Any code that deletes or resets demo data filters on `role: "DEMO"` in the query.

## 5. Tests

Add to `backend/tests/integration/` (real PostgreSQL) for behaviour and to `tests/unit/` for pure logic.

- Use `createTestApp`, `loginAsAdmin` and `client` from `tests/integration/app-client.ts`; create rows with `productData()` from `helpers.ts` so they get an owner.
- For anything that reads or changes products, photos or sales, add a case to the "never see or change each other's items" block in `demo.test.ts`: the other account gets 404 and nothing changes.
- eBay is never called. Script its answers with `tests/support/fake-ebay.ts` and pass `{ fetch: ebay.fetch }` to `createTestApp`.

```bash
cd backend && npx vitest run tests/integration/<file>.test.ts
```

## 6. Before calling it done

```bash
npm run typecheck && npm test        # from the repo root
```

If the change is a design decision or changes behaviour described there, update `docs/architecture.md`. If you relied on a fact about eBay's API that you could not check, mark it as unconfirmed there.
