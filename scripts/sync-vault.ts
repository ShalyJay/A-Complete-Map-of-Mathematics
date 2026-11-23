/**
 * Refresh data/vault/ from the Personal Wiki vault, for local development.
 *
 *   npm run sync:vault                 # export from $VAULT_DIR (default ../Personal Wiki)
 *   npm run sync:vault -- --from DIR   # copy an export that already exists (graph.json + references.json)
 *
 * The vault's exporter runs its own privacy/structure judge (--check) before writing anything.
 * Production updates do not use this script: the vault's git hook (_tools/site_sync.sh) exports the
 * committed vault and pushes data/vault/ to GitHub.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const OUT = path.join(process.cwd(), "data", "vault");
const args = process.argv.slice(2);
const fromIdx = args.indexOf("--from");

fs.mkdirSync(OUT, { recursive: true });
if (fromIdx >= 0) {
  const from = path.resolve(args[fromIdx + 1] ?? "");
  for (const f of ["graph.json", "references.json"]) fs.copyFileSync(path.join(from, f), path.join(OUT, f));
  console.log(`copied export from ${from}`);
} else {
  const vault = path.resolve(process.env.VAULT_DIR ?? path.join(process.cwd(), "..", "Personal Wiki"));
  const py = path.join(vault, "_tools", ".venv", "bin", "python");
  const exporter = path.join(vault, "_tools", "export_site.py");
  if (!fs.existsSync(exporter)) {
    console.error(`No exporter at ${exporter}. Set VAULT_DIR to the Personal Wiki vault.`);
    process.exit(1);
  }
  const r = spawnSync(fs.existsSync(py) ? py : "python3", [exporter, "--check", "--out", OUT], { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
console.log(`data/vault updated; run \`npm run validate:graph\``);
