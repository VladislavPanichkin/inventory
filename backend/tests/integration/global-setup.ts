import { execFileSync } from "node:child_process";
import { resolveTestDatabaseUrl } from "./test-database-url.js";

/** Applies all migrations to the dedicated test database before integration tests run. */
export default function setup() {
  const url = resolveTestDatabaseUrl();
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: url },
  });
}
