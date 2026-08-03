/**
 * Ensure local PGlite / Postgres tables exist.
 * Usage: npm run db:ensure
 */
import { getDb } from "../src/db/index";
import { ensureSchema } from "../src/db/migrate";

async function main() {
  const db = await getDb();
  await ensureSchema(db);
  console.log("Schema ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
