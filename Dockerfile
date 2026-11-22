# Production image: one container serving the API and the built web app on one port.
# Build:  docker build -t inventory .
# Run:    docker run -p 8080:8080 -e DATABASE_URL=... -e TOKEN_ENCRYPTION_KEY=... -e FRONTEND_URL=https://... inventory

# ---------- build ----------
FROM node:24-bookworm-slim AS build
# OpenSSL is required by Prisma's schema engine (migrations).
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Install dependencies first (better layer caching). The Prisma schema is needed by the
# postinstall `prisma generate`; the config needs *a* DATABASE_URL, not a real one.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
COPY package.json package-lock.json ./
COPY backend/package.json backend/prisma.config.ts backend/tsconfig.json backend/
COPY backend/prisma backend/prisma
COPY frontend/package.json frontend/
RUN npm ci

COPY . .
RUN npm run build -w backend && npm run build -w frontend \
 && npm prune --omit=dev

# ---------- runtime ----------
FROM node:24-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /app /app
USER node
WORKDIR /app/backend
EXPOSE 8080

# Apply pending migrations, then start. `exec` makes node PID 1's child receive SIGTERM directly.
CMD ["sh", "-c", "npx --no-install prisma migrate deploy && exec node dist/server.js"]
