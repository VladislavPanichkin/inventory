/**
 * Resolves the integration-test database URL and refuses anything that doesn't
 * look like a dedicated test database, so tests can never wipe development data.
 */
export function resolveTestDatabaseUrl(): string {
  try {
    process.loadEnvFile(".env");
  } catch {
    /* env provided by the shell / CI */
  }

  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL is not set. See backend/.env.example.");
  }
  const databaseName = new URL(url).pathname.replace(/^\//, "");
  if (!databaseName.endsWith("_test")) {
    throw new Error(`Refusing to run integration tests against "${databaseName}": database name must end with "_test".`);
  }
  return url;
}
