import type { Logger } from "../../common/logger.js";
import type { AppDeps } from "../../common/router.js";
import { UserRole } from "../../generated/prisma/enums.js";
import { AdminPasswordPolicyError, assertPasswordPolicy, KNOWN_DEFAULT_PASSWORDS } from "../authentication/admin-account.js";
import { normalizeEmail } from "../authentication/auth.service.js";
import { hashPassword, verifyPassword } from "../authentication/password.js";
import { createDemoService } from "./demo.service.js";

export type DemoAccountOutcome = "created" | "updated" | "unchanged" | "removed" | "off" | "invalid";

/**
 * Brings the demo account in line with DEMO_EMAIL / DEMO_PASSWORD at start:
 *
 * - both set: the account exists with exactly that email and password (changing either
 *   variable changes the account and signs out every demo session);
 * - not set: the account, its items, photos and sessions are deleted.
 *
 * A bad value (password too short, email already used by the administrator) never stops the
 * app from starting: the demo account is left switched off and the reason is logged.
 */
export async function syncDemoAccountFromConfig(deps: AppDeps, logger: Logger = deps.logger): Promise<DemoAccountOutcome> {
  const { db, config } = deps;
  const demo = createDemoService(deps);

  if (!config.DEMO_EMAIL || !config.DEMO_PASSWORD) {
    const removed = await demo.removeAccounts();
    if (removed > 0) logger.info("Demo account removed (DEMO_EMAIL / DEMO_PASSWORD are not set)");
    return removed > 0 ? "removed" : "off";
  }

  const email = normalizeEmail(config.DEMO_EMAIL);
  const refuse = async (reason: string): Promise<DemoAccountOutcome> => {
    // Leaving an old demo login active after its settings became invalid would be surprising.
    await demo.removeAccounts();
    logger.error("Demo account is switched off", { reason });
    return "invalid";
  };

  try {
    assertPasswordPolicy(config.DEMO_PASSWORD);
  } catch (error) {
    if (error instanceof AdminPasswordPolicyError) return refuse(`DEMO_PASSWORD: ${error.message}`);
    throw error;
  }
  if (config.NODE_ENV === "production" && KNOWN_DEFAULT_PASSWORDS.has(config.DEMO_PASSWORD)) {
    return refuse("DEMO_PASSWORD is an example default; choose another password.");
  }
  const sameEmail = await db.adminUser.findUnique({ where: { email } });
  if (sameEmail && sameEmail.role !== UserRole.DEMO) {
    return refuse("DEMO_EMAIL is the administrator's email; the demo account needs its own.");
  }

  const existing = await db.adminUser.findFirst({ where: { role: UserRole.DEMO }, orderBy: { createdAt: "asc" } });
  if (!existing) {
    const created = await db.adminUser.create({
      data: { email, passwordHash: await hashPassword(config.DEMO_PASSWORD), role: UserRole.DEMO },
    });
    await demo.reset(created.id);
    logger.info("Demo account created", { email });
    return "created";
  }

  if (existing.email === email && (await verifyPassword(config.DEMO_PASSWORD, existing.passwordHash))) {
    return "unchanged";
  }
  const passwordHash = await hashPassword(config.DEMO_PASSWORD);
  await db.$transaction([
    db.adminSession.deleteMany({ where: { adminUserId: existing.id } }),
    db.adminUser.updateMany({ where: { id: existing.id, role: UserRole.DEMO }, data: { email, passwordHash } }),
  ]);
  logger.info("Demo account updated from environment; its sessions were signed out", { email });
  return "updated";
}
