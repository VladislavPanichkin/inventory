import { defineConfig, env } from "prisma/config";

// Prisma 7 no longer loads .env automatically. Use Node's built-in loader
// (no dotenv dependency); a missing file is fine when vars come from the shell/CI.
try {
  process.loadEnvFile(".env");
} catch {
  /* no .env file */
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
