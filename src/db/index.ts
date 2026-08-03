import * as schema from "./schema";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

export type Db = PostgresJsDatabase<typeof schema>;

/**
 * Database client factory.
 *
 * - If DATABASE_URL is set (e.g. a Supabase Postgres connection string), use it.
 * - Otherwise fall back to an embedded PGlite database stored in ./.data/pglite,
 *   so the whole app (including ingestion) runs with zero external services.
 *
 * A global singleton keeps Next.js dev-mode HMR from opening duplicate handles.
 * Note: PGlite is single-writer — don't run ingest scripts while `next dev` holds the DB.
 */
const globalForDb = globalThis as unknown as { __mathmapDb?: Db };

async function createDb(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { default: postgres } = await import("postgres");
    const client = postgres(url, { prepare: false });
    return drizzle(client, { schema });
  }
  const { drizzle } = await import("drizzle-orm/pglite");
  const { PGlite } = await import("@electric-sql/pglite");
  const path = await import("node:path");
  const dataDir = path.join(process.cwd(), ".data", "pglite");
  const client = new PGlite(dataDir);
  return drizzle(client, { schema }) as unknown as Db;
}

export async function getDb(): Promise<Db> {
  if (!globalForDb.__mathmapDb) {
    globalForDb.__mathmapDb = await createDb();
  }
  return globalForDb.__mathmapDb;
}

export { schema };
