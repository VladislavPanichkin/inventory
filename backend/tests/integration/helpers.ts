import { Prisma } from "../../src/generated/prisma/client.js";
import { createDatabase, type Database } from "../../src/infrastructure/database.js";
import { resolveTestDatabaseUrl } from "./test-database-url.js";

export function createTestDatabase(): Database {
  return createDatabase(resolveTestDatabaseUrl());
}

/** Empties every application table (keeps the migrations table). */
export async function resetDatabase(db: Database): Promise<void> {
  const rows = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const tables = rows.map((row) => `"public"."${row.tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}

let counter = 0;

/** Email of the administrator used by the tests (see `loginAsAdmin`). */
export const TEST_ADMIN_EMAIL = "admin@example.com";

/**
 * Data for a product owned by the test administrator. The administrator row is created on
 * the fly when the test hasn't logged in yet; `loginAsAdmin` then just sets its password.
 */
export function productData(overrides: Partial<Prisma.ProductCreateInput> = {}): Prisma.ProductCreateInput {
  counter += 1;
  return {
    name: `Test item ${counter}`,
    price: new Prisma.Decimal("10.00"),
    currency: "EUR",
    owner: {
      connectOrCreate: {
        where: { email: TEST_ADMIN_EMAIL },
        create: { email: TEST_ADMIN_EMAIL, passwordHash: "not-a-usable-hash" },
      },
    },
    ...overrides,
  };
}

/** Returns the Prisma error code (e.g. P2002) of a rejected promise. */
export async function prismaErrorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code;
    throw error;
  }
  return undefined;
}
