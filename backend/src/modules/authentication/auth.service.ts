import { nowFrom, type AppDeps, type UserRole } from "../../common/router.js";
import { createDemoService } from "../demo/demo.service.js";
import { hashPassword, verifyPassword } from "./password.js";
import { generateSessionToken, hashSessionToken } from "./session-token.js";

/** A session expires after 7 days without activity, and after 30 days regardless. */
export const SESSION_IDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Activity is written back at most this often, to avoid a DB write per request. */
export const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/** The signed-in account as the rest of the backend sees it. */
export interface SessionUser {
  id: string;
  email: string;
  role: UserRole;
  /** Changes the demo account has used up (always 0 for the administrator). */
  demoChangesUsed: number;
}

export interface LoginResult {
  token: string;
  expiresAt: Date;
  admin: SessionUser;
}

export interface AuthenticatedSession {
  admin: SessionUser;
  sessionId: string;
  /** Set when the session's expiry was extended and the cookie should be re-issued. */
  renewedExpiresAt?: Date;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function createAuthService(deps: AppDeps) {
  const { db } = deps;
  const demo = createDemoService(deps);
  // Verifying against a dummy hash when the email is unknown keeps response times
  // similar, so login can't be used to discover whether an account exists.
  let dummyHash: Promise<string> | undefined;

  return {
    async login(email: string, password: string, userAgent?: string): Promise<LoginResult | null> {
      const now = nowFrom(deps);
      const admin = await db.adminUser.findUnique({ where: { email: normalizeEmail(email) } });

      if (!admin) {
        dummyHash ??= hashPassword("timing-equalisation-dummy-password");
        await verifyPassword(password, await dummyHash);
        return null;
      }
      if (!(await verifyPassword(password, admin.passwordHash))) return null;

      const token = generateSessionToken();
      const expiresAt = new Date(now.getTime() + SESSION_IDLE_TTL_MS);
      await db.$transaction([
        db.adminSession.deleteMany({ where: { adminUserId: admin.id, expiresAt: { lte: now } } }),
        db.adminSession.create({
          data: {
            tokenHash: await hashSessionToken(token),
            adminUserId: admin.id,
            expiresAt,
            lastSeenAt: now,
            createdAt: now,
            userAgent: userAgent?.slice(0, 255) ?? null,
          },
        }),
      ]);
      // Each demo sign-in starts from the same sample items with the full change allowance.
      // Done after the password check, so only someone who knows the demo password can trigger it.
      if (admin.role === "DEMO") await demo.reset(admin.id);

      return {
        token,
        expiresAt,
        admin: {
          id: admin.id,
          email: admin.email,
          role: admin.role,
          demoChangesUsed: admin.role === "DEMO" ? 0 : admin.demoChangesUsed,
        },
      };
    },

    async authenticate(token: string): Promise<AuthenticatedSession | null> {
      const now = nowFrom(deps);
      const session = await db.adminSession.findUnique({
        where: { tokenHash: await hashSessionToken(token) },
        include: { adminUser: true },
      });
      if (!session) return null;

      const absoluteExpiry = session.createdAt.getTime() + SESSION_ABSOLUTE_TTL_MS;
      if (session.expiresAt.getTime() <= now.getTime() || absoluteExpiry <= now.getTime()) {
        await db.adminSession.deleteMany({ where: { id: session.id } });
        return null;
      }

      const result: AuthenticatedSession = {
        admin: {
          id: session.adminUser.id,
          email: session.adminUser.email,
          role: session.adminUser.role,
          demoChangesUsed: session.adminUser.demoChangesUsed,
        },
        sessionId: session.id,
      };

      if (now.getTime() - session.lastSeenAt.getTime() >= SESSION_TOUCH_INTERVAL_MS) {
        const renewedExpiresAt = new Date(Math.min(now.getTime() + SESSION_IDLE_TTL_MS, absoluteExpiry));
        await db.adminSession.update({
          where: { id: session.id },
          data: { lastSeenAt: now, expiresAt: renewedExpiresAt },
        });
        result.renewedExpiresAt = renewedExpiresAt;
      }
      return result;
    },

    async logout(token: string): Promise<void> {
      await db.adminSession.deleteMany({ where: { tokenHash: await hashSessionToken(token) } });
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
