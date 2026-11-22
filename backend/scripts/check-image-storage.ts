/**
 * Verifies the configured photo bucket end to end: upload → download → delete → gone.
 * Uses one tiny object under `healthcheck/`, removed again at the end.
 *
 *   railway run --service inventory-app -- npm run storage:check -w backend
 *
 * Reads S3_* from the environment; prints no credentials.
 */
import { loadConfig, hasS3Config } from "../src/config/env.js";
import { createS3ImageStorage } from "../src/infrastructure/image-storage.js";

async function main() {
  const config = loadConfig({ ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? "unused", NODE_ENV: "development" });
  if (!hasS3Config(config)) throw new Error("S3_ENDPOINT / S3_REGION / S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY are not all set");

  const storage = createS3ImageStorage({
    endpoint: config.S3_ENDPOINT!,
    region: config.S3_REGION!,
    bucket: config.S3_BUCKET!,
    accessKeyId: config.S3_ACCESS_KEY_ID!,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY!,
  });

  const key = `healthcheck/${crypto.randomUUID()}.jpg`;
  const payload = crypto.getRandomValues(new Uint8Array(2048));
  console.log(`bucket: ${config.S3_BUCKET}  endpoint: ${config.S3_ENDPOINT}  region: ${config.S3_REGION}`);

  let started = performance.now();
  await storage.put(key, payload, "image/jpeg");
  console.log(`upload:   ok (${Math.round(performance.now() - started)} ms)`);

  started = performance.now();
  const object = await storage.get(key);
  if (!object) throw new Error("uploaded object not found");
  const bytes = object.body instanceof Uint8Array ? object.body : new Uint8Array(await new Response(object.body).arrayBuffer());
  const identical = bytes.length === payload.length && bytes.every((byte, i) => byte === payload[i]);
  if (!identical) throw new Error("downloaded bytes differ from what was uploaded");
  console.log(`download: ok, ${bytes.length} bytes identical (${Math.round(performance.now() - started)} ms)`);

  await storage.delete([key]);
  if ((await storage.get(key)) !== null) throw new Error("object still exists after delete");
  console.log("delete:   ok, object is gone");
  console.log("Photo storage check passed.");
}

main().catch((error) => {
  console.error("Photo storage check FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
