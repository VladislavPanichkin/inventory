/**
 * Creates the single administrator or changes its email/password.
 * Revokes all existing sessions.
 *
 *   ADMIN_PASSWORD='a-long-passphrase' npm run admin:set-password -w backend -- --email you@example.com
 *
 * The password is read from the ADMIN_PASSWORD environment variable (never from argv,
 * which would leak into shell history and process listings). --email falls back to ADMIN_EMAIL.
 */
import { AdminPasswordPolicyError, setAdminCredentials } from "../src/modules/authentication/admin-account.js";
import { createDatabase } from "../src/infrastructure/database.js";

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const email = argValue("--email") ?? process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  if (!email) throw new Error("Provide --email <address> or set ADMIN_EMAIL");
  if (!password) throw new Error("Set ADMIN_PASSWORD in the environment");

  const db = createDatabase(databaseUrl);
  try {
    const result = await setAdminCredentials(db, email, password);
    console.log(`Administrator ${result.action}: ${result.email}. All existing sessions were revoked.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof AdminPasswordPolicyError || error instanceof Error ? error.message : error);
  process.exit(1);
});
