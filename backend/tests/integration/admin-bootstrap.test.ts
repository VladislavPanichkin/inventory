import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "../../src/common/logger.js";
import {
  AdminPasswordPolicyError,
  bootstrapAdminFromConfig,
  setAdminCredentials,
} from "../../src/modules/authentication/admin-account.js";
import { verifyPassword } from "../../src/modules/authentication/password.js";
import { createTestDatabase, resetDatabase } from "./helpers.js";

const db = createTestDatabase();
const logger = createLogger({ sink: () => {} });

beforeEach(async () => {
  await resetDatabase(db);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("first-start administrator bootstrap", () => {
  it("creates the admin from config when none exists", async () => {
    const result = await bootstrapAdminFromConfig(
      db,
      { NODE_ENV: "production", ADMIN_EMAIL: "Owner@Example.com", ADMIN_PASSWORD: "a-real-long-passphrase" },
      logger,
    );
    expect(result).toBe("created");
    const admin = await db.adminUser.findFirstOrThrow();
    expect(admin.email).toBe("owner@example.com");
    expect(await verifyPassword("a-real-long-passphrase", admin.passwordHash)).toBe(true);
  });

  it("never touches an existing admin (env vars can stay set)", async () => {
    await setAdminCredentials(db, "owner@example.com", "original-password-1");
    const result = await bootstrapAdminFromConfig(
      db,
      { NODE_ENV: "production", ADMIN_EMAIL: "other@example.com", ADMIN_PASSWORD: "different-password-2" },
      logger,
    );
    expect(result).toBe("exists");
    const admin = await db.adminUser.findFirstOrThrow();
    expect(admin.email).toBe("owner@example.com");
    expect(await verifyPassword("original-password-1", admin.passwordHash)).toBe(true);
  });

  it("skips quietly when not configured", async () => {
    expect(await bootstrapAdminFromConfig(db, { NODE_ENV: "production" }, logger)).toBe("skipped");
    expect(await db.adminUser.count()).toBe(0);
  });

  it("refuses the documented example password in production, and short passwords anywhere", async () => {
    await expect(
      bootstrapAdminFromConfig(db, { NODE_ENV: "production", ADMIN_EMAIL: "a@b.co", ADMIN_PASSWORD: "change-me-please" }, logger),
    ).rejects.toBeInstanceOf(AdminPasswordPolicyError);
    await expect(
      bootstrapAdminFromConfig(db, { NODE_ENV: "development", ADMIN_EMAIL: "a@b.co", ADMIN_PASSWORD: "short" }, logger),
    ).rejects.toBeInstanceOf(AdminPasswordPolicyError);
    expect(await db.adminUser.count()).toBe(0);
  });
});
