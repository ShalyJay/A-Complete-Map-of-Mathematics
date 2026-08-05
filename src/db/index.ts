import * as schema from "./schema";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

export type Db = PostgresJsDatabase<typeof schema>;

/**
 * Local graph database (embedded PGlite in ./.data/pglite).
 * Optional DATABASE_URL overrides with Postgres if you want a remote graph store.
 *
 * Personal data (mastery, document analyses) is NOT here — it lives in the
 * browser's localStorage.
 *
 * PGlite is single-writer — don't run ingest scripts while `next dev` holds the DB.
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
