import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

/**
 * Infrastructure boundary: the only place that knows how we connect to Postgres.
 *
 * Prisma 7 uses driver adapters; locally that's node-postgres (`pg`) via
 * @prisma/adapter-pg. A future Cloudflare Workers deployment would swap the
 * adapter/connection strategy here (e.g. Hyperdrive or a Supabase pooler URL)
 * without touching modules, which only depend on the `Database` type.
 */
export type Database = PrismaClient;

export function createDatabase(connectionString: string): Database {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export async function checkDatabase(db: Database): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = performance.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Math.round(performance.now() - started) };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - started),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
