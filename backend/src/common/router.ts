import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { RequestIdVariables } from "hono/request-id";
import type { AppConfig } from "../config/env.js";
import type { Database } from "../infrastructure/database.js";
import type { ImageStorage } from "../infrastructure/image-storage.js";
import type { Logger } from "./logger.js";
import type { RateLimitStore } from "./rate-limit.js";
import { errorBody } from "./http.js";

/** Dependencies injected into every module (no global singletons). */
export interface AppDeps {
  config: AppConfig;
  db: Database;
  logger: Logger;
  /** Overridable clock, for deterministic tests. */
  now?: () => Date;
  /** Returns the client IP. Runtime-specific (Node socket, CF-Connecting-IP, ...). */
  getClientIp?: (c: Context) => string | undefined;
  /** Rate-limit counter storage. Defaults to in-memory (single process). */
  rateLimitStore?: RateLimitStore;
  /** HTTP client for outbound calls (eBay). Injectable so tests never hit the network. */
  fetch?: typeof fetch;
  /** Where uploaded product photos are stored (bucket, local folder, or memory in tests). */
  imageStorage: ImageStorage;
  /**
   * Reads a bundled sample photo for the demo account by file name (e.g. "leica-m3.jpg"),
   * or null when there is none. Runtime-specific (files on Node). Without it the sample
   * items simply have no photos.
   */
  demoPhotos?: (fileName: string) => Promise<Uint8Array | null>;
}

export type UserRole = "ADMIN" | "DEMO";

/** The signed-in account. Every product query is limited to `id` (the owner). */
export interface AuthenticatedAdmin {
  id: string;
  email: string;
  role: UserRole;
  /** Changes made by the demo account since its last reset (always 0 for the administrator). */
  demoChangesUsed: number;
  sessionId: string;
}

export type AppEnv = {
  Variables: RequestIdVariables & {
    /** Set by the auth guard on protected routes. */
    admin: AuthenticatedAdmin;
  };
};

/**
 * Creates a module router whose request validation failures return the standard
 * error envelope (400 VALIDATION_ERROR) instead of zod-openapi's default body.
 */
export function createRouter() {
  return new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        const details = result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        }));
        return c.json(errorBody("VALIDATION_ERROR", "Request validation failed", details, c.get("requestId")), 400);
      }
    },
  });
}

export const nowFrom = (deps: AppDeps) => deps.now?.() ?? new Date();
