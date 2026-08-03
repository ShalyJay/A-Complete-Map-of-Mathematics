/** Print the number of nodes in the database (used by the Docker entrypoint). */
import { sql } from "drizzle-orm";
import { getDb } from "../src/db/index";

async function main() {
  const db = await getDb();
  try {
    const r = await db.execute(sql`select count(*)::int as n from nodes`);
    const rows = ((r as { rows?: { n: number }[] }).rows ??
      (Array.isArray(r) ? r : [])) as { n: number }[];
    console.log(rows[0]?.n ?? 0);
  } catch {
    console.log(0);
  }
  process.exit(0);
}

main();
