---
name: deploy
description: The full procedure for putting this app live on Railway - checks, a local Docker rehearsal, the deploy itself and verification of the live app. Use it whenever the user asks to deploy, release, ship, publish to production or "put it live", and when asked why a deployment failed. Never deploy without being asked.
---

# Deploy

Production is one Railway service, `inventory-app`, built from the `Dockerfile`, with a managed PostgreSQL and a photo bucket. The container applies pending database migrations on every start and Railway switches over only once `/api/v1/health` answers.

Deploys go from this folder with the Railway CLI; pushing to GitHub does not deploy. Deploy only when the user asks, and commit or push only if they asked for that too.

Run each step below as its own, clearly described command. If Docker is not running, say so and ask; do not start Docker Desktop yourself.

## 1. Checks

```bash
npm run typecheck && npm test && npm run build
```

Stop on any failure and report it.

## 2. Rehearse the real image locally

Tests do not start the production image. This step has caught a startup crash and missing packaged files that the tests could not.

```bash
docker build -t inventory:local .
docker exec inventory-postgres psql -U inventory -d postgres -c 'CREATE DATABASE inventory_rehearsal'
docker run -d --name inventory-rehearsal -p 8081:8080 \
  -e DATABASE_URL=postgresql://inventory:inventory@host.docker.internal:5432/inventory_rehearsal \
  -e TOKEN_ENCRYPTION_KEY="$(node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))')" \
  -e FRONTEND_URL=https://rehearsal.invalid -e IMAGE_STORAGE=local \
  -e ADMIN_EMAIL=owner@example.com -e ADMIN_PASSWORD=rehearsal-admin-password \
  -e DEMO_EMAIL=demo@example.com -e DEMO_PASSWORD=rehearsal-demo-password \
  inventory:local
```

Then, against `http://localhost:8081`:

- `/api/v1/health` answers 200 with the database up, and `docker logs inventory-rehearsal` shows "All migrations have been successfully applied" and no error lines.
- Sign in as both accounts and exercise what this release changed. The session cookie is marked Secure in production mode, so read it from the `Set-Cookie` header of the login response and send it back yourself in a `Cookie` header.
- `/` answers 200 (the web app is in the image).

If the release contains a migration that changes existing rows, an empty database proves little. Say so, and rely on the migration having run against the local development database, which has data.

Clean up either way:

```bash
docker rm -f inventory-rehearsal
docker exec inventory-postgres psql -U inventory -d postgres -c 'DROP DATABASE inventory_rehearsal'
```

## 3. Commit and push (only if asked)

Run the `publish-check` skill on the staged changes first; the repository is public.

## 4. Deploy

```bash
railway up --service inventory-app --detach -y
```

Take the deployment ID from the link it prints, then wait for the result:

```bash
railway deployment list --service inventory-app --json | jq -r '.[] | select(.id=="<id>") | .status'
```

Poll every ten seconds or so until it is `SUCCESS`, `FAILED` or `CRASHED` (a build takes about two minutes). Do not use `railway up --ci` through a pipe; it hangs. On failure read the logs:

```bash
railway logs --service inventory-app --build --lines 200 <id>
railway logs --service inventory-app --deployment --lines 200 <id>
```

## 5. Verify the live app

Take the live address from the service's own settings instead of writing it anywhere:

```bash
URL=$(railway variable list --service inventory-app --json | jq -r .FRONTEND_URL)
curl -s "$URL/api/v1/health" | jq '.data | {status, db: .checks.database.status}'
railway logs --service inventory-app --deployment --lines 200 <id> | grep -E "migration|ERROR|WARN"
```

Then check what the release changed on the live app. The demo account is the safe way to do that: sign in with `DEMO_EMAIL` and `DEMO_PASSWORD` piped straight from `railway variable list --json` into the login request, so the values never appear on screen. A demo sign-in resets the demo data, which is harmless.

## Settings and secrets

- They are Railway variables on the service. Set a secret through standard input (`railway variable set KEY --stdin --service inventory-app --skip-deploys`) and inspect only names, lengths and shapes with `jq`, never values.
- Changes the user makes in Railway's dashboard are staged until they press "Apply changes".
- `.railway/railway.ts` holds the service settings (build, health check, region). Railway does not read it during a deploy. After editing it, run `npm run railway:plan` and ask the user to run `railway config apply` themselves.
- Do not connect to the production database directly. Check production through the app and its logs.

## Report

Say what was deployed (commit), that the checks and the rehearsal passed, what you verified on the live app, and anything you could not verify, such as the owner's own data, which only the owner can see.
