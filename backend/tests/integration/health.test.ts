import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createLogger } from "../../src/common/logger.js";
import { loadConfig } from "../../src/config/env.js";
import { createMemoryImageStorage } from "../../src/infrastructure/image-storage.js";
import { createTestDatabase } from "./helpers.js";

const db = createTestDatabase();

afterAll(async () => {
  await db.$disconnect();
});

describe("health endpoint against a real database", () => {
  it("reports the database as up", async () => {
    const config = loadConfig({ DATABASE_URL: "unused", NODE_ENV: "test" });
    const app = createApp({ config, db, logger: createLogger({ sink: () => {} }), imageStorage: createMemoryImageStorage() });

    const res = await app.request("/api/v1/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { checks: { database: { status: string } } } };
    expect(body.data.checks.database.status).toBe("up");
  });
});
