/**
 * Chooses between live DB (local PGlite / DATABASE_URL) and the static
 * export used on Vercel serverless.
 */
import { hasStaticGraph } from "@/lib/staticGraph";

/** True when APIs should read data/static-graph.json instead of opening PGlite. */
export function shouldUseStaticGraph(): boolean {
  if (process.env.DATABASE_URL) return false;
  if (process.env.VERCEL === "1" || process.env.USE_STATIC_GRAPH === "1") {
    return true;
  }
  return false;
}

export function staticGraphRequiredMessage(): string {
  if (hasStaticGraph()) {
    return "Static graph is available.";
  }
  return (
    "This deployment has no database and no data/static-graph.json. " +
    "Locally run `npm run export:graph` after ingest, commit data/static-graph.json, and redeploy. " +
    "Or set DATABASE_URL to a hosted Postgres with the graph seeded."
  );
}
