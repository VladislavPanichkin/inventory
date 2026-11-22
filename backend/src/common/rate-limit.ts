import type { Context, MiddlewareHandler } from "hono";
import { errorBody } from "./http.js";

/**
 * Fixed-window rate limiting.
 *
 * The default store is in-memory, which is correct for a single Node process (our
 * deployment model). A multi-instance or Workers deployment would swap in a shared
 * store (e.g. a Postgres table or Cloudflare's rate-limiting binding) via `RateLimitStore`.
 */
export interface RateLimitStore {
  /** Increments the counter for `key` in the current window and returns the new count + window reset time. */
  hit(key: string, windowMs: number, now: number): { count: number; resetAt: number };
  reset(key: string): void;
}

export function createMemoryRateLimitStore(maxKeys = 10_000): RateLimitStore {
  const windows = new Map<string, { count: number; resetAt: number }>();

  return {
    hit(key, windowMs, now) {
      const current = windows.get(key);
      if (!current || current.resetAt <= now) {
        // Opportunistic cleanup keeps memory bounded.
        if (windows.size >= maxKeys) {
          for (const [k, v] of windows) if (v.resetAt <= now) windows.delete(k);
          if (windows.size >= maxKeys) windows.clear();
        }
        const fresh = { count: 1, resetAt: now + windowMs };
        windows.set(key, fresh);
        return fresh;
      }
      current.count += 1;
      return current;
    },
    reset(key) {
      windows.delete(key);
    },
  };
}

export interface RateLimitOptions {
  store: RateLimitStore;
  name: string;
  limit: number;
  windowMs: number;
  key: (c: Context) => string;
  now?: () => number;
}

export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  const now = options.now ?? Date.now;
  return async (c, next) => {
    const current = now();
    const { count, resetAt } = options.store.hit(`${options.name}:${options.key(c)}`, options.windowMs, current);
    const remaining = Math.max(0, options.limit - count);
    c.header("RateLimit-Limit", String(options.limit));
    c.header("RateLimit-Remaining", String(remaining));

    if (count > options.limit) {
      const retryAfter = Math.max(1, Math.ceil((resetAt - current) / 1000));
      c.header("Retry-After", String(retryAfter));
      return c.json(errorBody("RATE_LIMITED", "Too many requests, please try again later"), 429);
    }
    return next();
  };
}
