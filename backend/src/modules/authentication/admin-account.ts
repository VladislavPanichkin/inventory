import type { Logger } from "../../common/logger.js";
import type { AppConfig } from "../../config/env.js";
import type { Database } from "../../infrastructure/database.js";
import { UserRole } from "../../generated/prisma/enums.js";
import { normalizeEmail } from "./auth.service.js";
import { hashPassword, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "./password.js";

export class AdminPasswordPolicyError extends Error {}

/** Passwords shipped in examples/docs; never acceptable outside development. */
export const KNOWN_DEFAULT_PASSWORDS = new Set(["change-me-please"]);

/**
 * First-start provisioning for hosted deployments (no shell needed): if no administrator
 * exists and ADMIN_EMAIL/ADMIN_PASSWORD are set, create it. Never modifies an existing admin,
 * so the variables can stay set (or be removed) after the first start.
 */
export async function bootstrapAdminFromConfig(
  db: Database,
  config: Pick<AppConfig, "NODE_ENV" | "ADMIN_EMAIL" | "ADMIN_PASSWORD">,
  logger: Logger,
): Promise<"created" | "exists" | "skipped"> {
  if ((await db.adminUser.count({ where: { role: UserRole.ADMIN } })) > 0) return "exists";
  if (!config.ADMIN_EMAIL || !config.ADMIN_PASSWORD) {
    logger.warn("No administrator exists. Set ADMIN_EMAIL and ADMIN_PASSWORD to create one on start.");
    return "skipped";
  }
  if (config.NODE_ENV === "production" && KNOWN_DEFAULT_PASSWORDS.has(config.ADMIN_PASSWORD)) {
    throw new AdminPasswordPolicyError("ADMIN_PASSWORD is the example default; choose a real password.");
  }
  const result = await setAdminCredentials(db, config.ADMIN_EMAIL, config.ADMIN_PASSWORD);
  logger.info("Administrator created from environment", { email: result.email });
  return "created";
}

export function assertPasswordPolicy(password: string) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new AdminPasswordPolicyError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new AdminPasswordPolicyError(`Password must be at most ${MAX_PASSWORD_LENGTH} characters long.`);
  }
}

/**
 * Creates the single administrator, or updates its email/password if it exists.
 * Every existing administrator session is revoked, so a password change logs out all devices.
 * The demo account (a separate row with role DEMO) is never touched here.
 */
export async function setAdminCredentials(db: Database, email: string, password: string) {
  assertPasswordPolicy(password);
  const normalizedEmail = normalizeEmail(email);
  const passwordHash = await hashPassword(password);

  return db.$transaction(async (tx) => {
    const existing = await tx.adminUser.findFirst({ where: { role: UserRole.ADMIN }, orderBy: { createdAt: "asc" } });
    if (!existing) {
      const created = await tx.adminUser.create({
        data: { email: normalizedEmail, passwordHash, role: UserRole.ADMIN },
      });
      return { action: "created" as const, email: created.email };
    }
    await tx.adminSession.deleteMany({ where: { adminUser: { role: UserRole.ADMIN } } });
    // Enforce "single administrator": remove any extra administrator rows (should never exist).
    await tx.adminUser.deleteMany({ where: { role: UserRole.ADMIN, id: { not: existing.id } } });
    const updated = await tx.adminUser.update({
      where: { id: existing.id },
      data: { email: normalizedEmail, passwordHash },
    });
    return { action: "updated" as const, email: updated.email };
  });
}
