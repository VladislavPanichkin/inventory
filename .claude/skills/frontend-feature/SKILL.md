---
name: frontend-feature
description: Checklist for adding or changing a screen, component, form or data call in the React web app of this repo. Use it whenever work touches frontend/src, including small UI text or layout changes, because the data-refresh rules, the phone-first layout and the test setup here are not obvious from a single file.
---

# Frontend feature

The web app is React with TanStack Query, Tailwind and shadcn/ui components. It is used mostly on a phone, installed as an app.

## Where things go

| What | Where |
|---|---|
| Shapes of API data | `src/lib/types.ts` (mirror the backend's response exactly) |
| One function per API call | `src/services/` using `apiRequest` from `lib/api-client.ts` |
| Loading and changing data | `src/hooks/` (`useQuery` / `useMutation`) |
| Screens | `src/pages/`, registered in `src/routes.tsx` |
| Reusable pieces | `src/components/` (`ui/` holds the shadcn primitives) |

Reuse what exists before adding: `LoadingRows`, `ErrorState`, `EmptyState` and `errorMessage` in `components/states.tsx`, `ConfirmDialog`, `PageHeader`, `ProductThumbnail`, `formatMoney` and the date helpers in `lib/format.ts`.

## Data rules

- Nothing refreshes on its own: no polling, no refetch on focus (`staleTime: Infinity`, set in `lib/query-client.ts`). This is the owner's decision. Data loads when a screen opens, after the user's own change, and on manual refresh.
- So a mutation must invalidate every query its change affects, or the screen shows old data until a refresh. Changes to products usually also affect `["dashboard"]`.
- Show failures with `toast.error(errorMessage(error))`. The server's message is written for the user; do not replace it with a generic one.
- The browser never calls eBay or the photo bucket; everything goes through the API.

## Two accounts

`useMe()` returns the signed-in account with `role` (`ADMIN` or `DEMO`). The demo account uses the simulated eBay routes (`services/ebay.ts` picks the base path from the role) and sees a banner with its remaining changes. When a screen calls an API that the demo account cannot reach, branch on the role before the request is made, not after it fails.

## Layout

Design for a phone first and check the desktop second. Keep tap targets comfortable, let long titles wrap or clamp, and keep the primary action reachable without scrolling sideways. Respect the safe-area padding already used in `components/layout/app-layout.tsx`.

## Tests

Tests render the real route tree against a fake API:

```tsx
const { calls } = mockApi({ ...authed, "GET /products": page([productFixture()]) });
renderRoute("/products");
expect(await screen.findByText("Leica M3")).toBeInTheDocument();
```

- Helpers and fixtures are in `src/test/render.tsx` (`authed`, `demoAccount()`, `productFixture`, `imageFixture`, `page`, `errorResponse`).
- Toasts are not mounted in tests. Assert on what stays on the page or on the recorded `calls`, not on toast text.
- Find elements by role and accessible name, the way a user would. If a control cannot be found that way, give it a proper label rather than a test ID.
- Content that depends on loaded data needs `await screen.findBy...`, not `getBy...`.

```bash
cd frontend && npx vitest run src/pages/<file>.test.tsx
```

## Before calling it done

```bash
npm run typecheck -w frontend && npm test -w frontend
```

Then look at the result in a browser at phone width; type-checks and tests do not show a broken layout. The `run-app` skill starts the app and takes signed-in screenshots.
