/**
 * Session tokens: 256 bits of randomness, sent to the browser once (in an HTTP-only cookie).
 * The database stores only the SHA-256 hash, so a database leak doesn't expose live sessions.
 * Web Crypto only (works on Node and Workers).
 */

export function generateSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export async function hashSessionToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
