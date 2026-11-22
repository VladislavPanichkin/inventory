import { z } from "zod";

/**
 * Typed, validated application configuration.
 *
 * `loadConfig` takes a plain record instead of reading `process.env` directly so
 * the same code can later receive Cloudflare Worker bindings.
 */

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalString = z.preprocess(emptyToUndefined, z.string().min(1).optional());

const base64Key32 = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .refine((value) => {
      try {
        // atob is a Web API (Node + Workers); throws on invalid base64.
        return atob(value).length === 32;
      } catch {
        return false;
      }
    }, "must be 32 bytes encoded as base64")
    .optional(),
);

/**
 * Base scope + order access (sell.fulfillment, needed for sale detection in Phase 5).
 * Both strings appear verbatim in eBay's official OAuth client sources. A narrower
 * ".readonly" fulfillment scope could not be confirmed yet; switch via EBAY_SCOPES once verified.
 */
export const DEFAULT_EBAY_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
];

export const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  FRONTEND_URL: z.url().default("http://localhost:5173"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  /**
   * Set to "true" when running behind a reverse proxy (e.g. Railway) so the client IP for
   * rate limiting is taken from X-Forwarded-For (the entry appended by the proxy).
   */
  TRUST_PROXY: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),

  /** First-start administrator (created only if no admin exists yet; never overwritten). */
  ADMIN_EMAIL: z.preprocess(emptyToUndefined, z.email().optional()),
  ADMIN_PASSWORD: optionalString,

  /**
   * Optional demo account for showing the app to others. It gets its own sample items
   * (restored at every sign-in), no eBay access, and at most DEMO_CHANGE_LIMIT changes per
   * sign-in. Set both values to switch it on; remove them to delete the account and its data.
   */
  DEMO_EMAIL: z.preprocess(emptyToUndefined, z.email().optional()),
  DEMO_PASSWORD: optionalString,
  DEMO_CHANGE_LIMIT: z.coerce.number().int().min(0).max(1000).default(5),

  DEFAULT_CURRENCY: z
    .string()
    .regex(/^[A-Z]{3}$/, "must be an ISO 4217 code such as EUR")
    .default("EUR"),

  TOKEN_ENCRYPTION_KEY: base64Key32,

  /**
   * Photo storage. "s3" = S3-compatible bucket (production); "local" = a folder on disk
   * (development). When unset: s3 if all S3_* values are present, otherwise local.
   */
  IMAGE_STORAGE: z.preprocess(emptyToUndefined, z.enum(["s3", "local"]).optional()),
  S3_ENDPOINT: z.preprocess(emptyToUndefined, z.url().optional()),
  S3_REGION: optionalString,
  S3_BUCKET: optionalString,
  S3_ACCESS_KEY_ID: optionalString,
  S3_SECRET_ACCESS_KEY: optionalString,

  EBAY_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
  EBAY_CLIENT_ID: optionalString,
  EBAY_CLIENT_SECRET: optionalString,
  EBAY_RU_NAME: optionalString,
  EBAY_MARKETPLACE_ID: z.string().min(1).default("EBAY_DE"),
  EBAY_VERIFICATION_TOKEN: optionalString,
  /**
   * OAuth scopes requested at consent, space-separated. Defaults to scope strings confirmed
   * in eBay's official OAuth client sources. Override if the keyset's granted scopes differ.
   */
  EBAY_SCOPES: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .default(DEFAULT_EBAY_SCOPES.join(" "))
      .transform((value) => value.split(/\s+/).filter(Boolean))
      .pipe(z.array(z.url("each scope must be a URL")).min(1)),
  ),
});

export type AppConfig = z.infer<typeof configSchema>;

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid configuration:\n  - ${issues.join("\n  - ")}`);
    this.name = "ConfigError";
  }
}

type S3Settings = Pick<AppConfig, "S3_ENDPOINT" | "S3_REGION" | "S3_BUCKET" | "S3_ACCESS_KEY_ID" | "S3_SECRET_ACCESS_KEY">;

export function hasS3Config(config: S3Settings): boolean {
  return Boolean(
    config.S3_ENDPOINT && config.S3_REGION && config.S3_BUCKET && config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY,
  );
}

/** Which photo storage this configuration selects. */
export function imageStorageKind(config: S3Settings & Pick<AppConfig, "IMAGE_STORAGE">): "s3" | "local" {
  return config.IMAGE_STORAGE ?? (hasS3Config(config) ? "s3" : "local");
}

export function loadConfig(source: Record<string, string | undefined>): AppConfig {
  const result = configSchema.safeParse(source);
  if (!result.success) {
    // Report only variable names and rule violations, never the values (they may be secrets).
    throw new ConfigError(
      result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    );
  }

  const config = result.data;
  if (config.NODE_ENV === "production") {
    const issues: string[] = [];
    if (!config.TOKEN_ENCRYPTION_KEY) issues.push("TOKEN_ENCRYPTION_KEY: required in production");
    if (!config.FRONTEND_URL.startsWith("https://")) issues.push("FRONTEND_URL: must be an https:// URL in production");
    // A container's disk is wiped on every deploy: never fall back to it silently.
    if (!config.IMAGE_STORAGE && !hasS3Config(config)) {
      issues.push("S3_ENDPOINT/S3_REGION/S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY: photo storage is required in production (or set IMAGE_STORAGE=local explicitly)");
    }
    if (issues.length > 0) throw new ConfigError(issues);
  }
  if (config.IMAGE_STORAGE === "s3" && !hasS3Config(config)) {
    throw new ConfigError(["IMAGE_STORAGE=s3 requires S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY"]);
  }
  return config;
}

/** True when every credential needed for the eBay OAuth flow is configured. */
export function isEbayConfigured(config: AppConfig): boolean {
  return Boolean(
    config.EBAY_CLIENT_ID && config.EBAY_CLIENT_SECRET && config.EBAY_RU_NAME && config.TOKEN_ENCRYPTION_KEY,
  );
}
