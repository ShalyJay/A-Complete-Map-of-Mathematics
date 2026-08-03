import { sql } from "drizzle-orm";
import { getDb } from "../src/db/index";
async function main() {
  const db = await getDb();
  const orphans = await db.execute(sql`select count(*)::int as n from nodes where parent_id is not null and parent_id not in (select id from nodes)`);
  const noParent = await db.execute(sql`select id, title from nodes where parent_id is null and depth > 0 limit 10`);
  const edgeTypes = await db.execute(sql`select type, count(*)::int as n from edges group by type`);
  console.log("orphan parent refs:", orphans);
  console.log("depth>0 without parent:", noParent);
  console.log("edge types:", edgeTypes);
  process.exit(0);
}
main();
