/**
 * Node.js entry point (local development / container hosting).
 * Everything Node-specific lives here: env loading, the HTTP listener, signals,
 * serving the built frontend, and client-IP detection.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createLogger } from "./common/logger.js";
import { ConfigError, imageStorageKind, loadConfig, type AppConfig } from "./config/env.js";
import { clientIpResolver } from "./infrastructure/client-ip.js";
import { createDatabase } from "./infrastructure/database.js";
import { createDemoPhotoFiles } from "./infrastructure/demo-photo-files.js";
import { createS3ImageStorage, type ImageStorage } from "./infrastructure/image-storage.js";
import { createLocalImageStorage } from "./infrastructure/image-storage.local.js";
import { attachFrontend } from "./infrastructure/static-frontend.js";
import { AdminPasswordPolicyError, bootstrapAdminFromConfig } from "./modules/authentication/admin-account.js";
import { syncDemoAccountFromConfig } from "./modules/demo/demo-account.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** backend/src (tsx) or backend/dist (compiled) → ../../frontend/dist */
const DEFAULT_FRONTEND_DIST = path.resolve(HERE, "../../frontend/dist");
/** Development photo folder (gitignored): backend/.data/images */
const LOCAL_IMAGE_DIR = process.env.IMAGE_STORAGE_DIR ?? path.resolve(HERE, "../.data/images");
/** Sample photos for the demo account: backend/assets/demo-photos (part of the repository). */
const DEMO_PHOTO_DIR = process.env.DEMO_PHOTO_DIR ?? path.resolve(HERE, "../assets/demo-photos");

function createImageStorage(config: AppConfig): ImageStorage {
  if (imageStorageKind(config) === "s3") {
    return createS3ImageStorage({
      endpoint: config.S3_ENDPOINT!,
      region: config.S3_REGION!,
      bucket: config.S3_BUCKET!,
      accessKeyId: config.S3_ACCESS_KEY_ID!,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY!,
    });
  }
  return createLocalImageStorage(LOCAL_IMAGE_DIR);
}

async function main() {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const logger = createLogger({ level: config.NODE_ENV === "development" ? "debug" : "info" });
  const db = createDatabase(config.DATABASE_URL);

  try {
    await bootstrapAdminFromConfig(db, config, logger);
  } catch (error) {
    if (error instanceof AdminPasswordPolicyError) {
      logger.error("Refusing to create administrator", { reason: error.message });
      process.exit(1);
    }
    throw error;
  }

  const imageStorage = createImageStorage(config);
  logger.info("Photo storage ready", {
    kind: imageStorage.kind,
    ...(imageStorage.kind === "s3" ? { bucket: config.S3_BUCKET } : { directory: LOCAL_IMAGE_DIR }),
  });

  const deps = {
    config,
    db,
    logger,
    imageStorage,
    getClientIp: clientIpResolver(config),
    demoPhotos: createDemoPhotoFiles(DEMO_PHOTO_DIR),
  };
  // Creates, updates or removes the demo account according to DEMO_EMAIL / DEMO_PASSWORD.
  await syncDemoAccountFromConfig(deps);

  const app = createApp(deps);

  // In production the backend also serves the web app (single origin). In development
  // the Vite dev server serves it instead (with hot reload) and proxies /api here.
  if (config.NODE_ENV === "production") {
    attachFrontend(app, process.env.FRONTEND_DIST_DIR ?? DEFAULT_FRONTEND_DIST, logger);
  }

  const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
    logger.info("Server listening", { port: info.port, environment: config.NODE_ENV });
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("Shutting down", { signal });
    server.close(async () => {
      await db.$disconnect();
      process.exit(0);
    });
    // Force exit if connections don't drain.
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

void main();
