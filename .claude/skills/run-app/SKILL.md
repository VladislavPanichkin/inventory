---
name: run-app
description: Start this app locally and look at it - as the owner or as the demo account - including signed-in screenshots at phone and desktop width. Use it whenever a change should be seen working in the real app rather than only in tests, when the user asks to run, start, try, check or screenshot the app, and after any frontend change.
---

# Run the app locally

Three processes: PostgreSQL (Docker), the backend on :3000, the frontend dev server on :5173.

Start each one as its own, clearly described command, and run the two servers in the background. The owner wants every side-effecting step separate, and does not want desktop apps opened without being asked: if Docker is not running, say so and ask, do not start Docker Desktop yourself.

## Start

```bash
npm run db:up            # PostgreSQL; needs Docker running
npm run dev:backend      # background
npm run dev:frontend     # background
```

Wait for `http://localhost:3000/api/v1/health` to answer 200 before using the app.

To have the demo account locally, start the backend with it switched on. The values are for local use only:

```bash
DEMO_EMAIL=demo@example.com DEMO_PASSWORD=local-demo-password npm run dev:backend
```

The demo account and its data are deleted again the next time the backend starts without these two variables. That is by design.

## Check the API directly

Changing requests need the `X-Requested-With: fetch` header. Keep the session in a cookie file inside the scratchpad and delete it afterwards:

```bash
curl -s -c "$JAR" -H 'X-Requested-With: fetch' -H 'Content-Type: application/json' \
  -d '{"email":"demo@example.com","password":"local-demo-password"}' http://localhost:3000/api/v1/auth/login
curl -s -b "$JAR" 'http://localhost:3000/api/v1/products?status=ALL' | jq '.meta'
```

For the owner's account, the email and password are in `backend/.env` (`ADMIN_EMAIL`, `ADMIN_PASSWORD`). Use them from the environment; never print them.

## See it signed in (screenshots)

A headless browser cannot type a password, so a small proxy signs in once and forwards everything with that session.

1. Start the proxy in the background (demo account shown; for the owner use `node --env-file=backend/.env` and pass `APP_EMAIL="$ADMIN_EMAIL" APP_PASSWORD="$ADMIN_PASSWORD"` from that file without echoing them):

   ```bash
   APP_EMAIL=demo@example.com APP_PASSWORD=local-demo-password node .claude/skills/run-app/scripts/signed-in-proxy.mjs
   ```

2. Start the frontend pointed at it, in the background:

   ```bash
   BACKEND_URL=http://localhost:3100 npm run dev:frontend
   ```

3. Take pictures into the scratchpad, then read them:

   ```bash
   sh .claude/skills/run-app/scripts/screenshot.sh /products 500,1100 "$SCRATCH/products-phone.png"
   sh .claude/skills/run-app/scripts/screenshot.sh /settings/ebay 1280,1100 "$SCRATCH/ebay-desktop.png"
   ```

Notes:

- 500 px is the narrowest width headless Chrome renders correctly; use it as the phone width.
- A demo sign-in resets the demo data. Start the proxy first, then make the changes you want to see (through the proxy on :3100), then take the pictures.
- To see a state that needs a click (a connected simulated eBay, an added listing), make the request through the proxy with curl first, then screenshot.

## Stop

Stop what you started, by port, and say that you did:

```bash
for p in 5173 3100 3000; do pid=$(lsof -ti tcp:$p -sTCP:LISTEN); [ -n "$pid" ] && kill $pid; done
```

Background tasks stopped this way are reported as "failed (exit 143)"; that is expected. Leave the PostgreSQL container running unless asked.
