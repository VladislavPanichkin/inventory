import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppConfig } from "../../config/env.js";

/**
 * Session cookie: HttpOnly (no JS access), SameSite=Lax (sent on top-level navigations
 * such as the eBay OAuth redirect back to us, but not on cross-site subrequests),
 * Secure in production.
 *
 * In production the `__Host-` prefix makes browsers enforce Secure, Path=/ and no
 * Domain attribute. Plain http://localhost can't use it, so dev uses an unprefixed name.
 */
export function sessionCookieName(config: AppConfig): string {
  return config.NODE_ENV === "production" ? "__Host-inventory_session" : "inventory_session";
}

export function readSessionCookie(c: Context, config: AppConfig): string | undefined {
  return getCookie(c, sessionCookieName(config));
}

export function writeSessionCookie(c: Context, config: AppConfig, token: string, expiresAt: Date, now: Date) {
  setCookie(c, sessionCookieName(config), token, {
    httpOnly: true,
    secure: config.NODE_ENV === "production",
    sameSite: "Lax",
    path: "/",
    maxAge: Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000)),
  });
}

export function clearSessionCookie(c: Context, config: AppConfig) {
  deleteCookie(c, sessionCookieName(config), {
    path: "/",
    secure: config.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "Lax",
  });
}
