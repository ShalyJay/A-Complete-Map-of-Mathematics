/**
 * Curated derivation edges between named results.
 *
 * Wikidata's dependency properties (P3452 "inferred from", P144 "based on",
 * P737 "influenced by", P2283 "uses") are almost empty for mathematics — the
 * previous ingest found under a dozen usable links. This file encodes the
 * classic derivation chains you'd find in a standard curriculum: which axioms
 * and theorems each famous result's standard proof builds on.
 *
 * Each pair is [dependent, prerequisite] — the proof of the first uses the
 * second. Stored as edges {source: dependent, target: prerequisite,
 * type: "depends-on"}, matching the Wikidata ingest convention.
 *
 * Matching is by (normalized) title against axiom/theorem/conjecture nodes.
 * Unmatched titles are logged and skipped, so this list can safely be more
 * ambitious than the current dataset.
 *
 * Usage: npm run ingest:deps   (run after ingest:wikidata)
 */
import { eq, inArray, like, or } from "drizzle-orm";
import { getDb, schema } from "../src/db/index";
import { chunk } from "./lib";

/**
 * Famous results that Wikidata failed to deliver (missing labels, untyped
 * items, or unattachable) but that the derivation map needs. Each is created
 * as a `seed:` node under the given MSC code (with fallback to its subfield /
 * field if the exact code is absent).
 */
const SEED_ENTITIES: {
  slug: string;
  title: string;
  type: "axiom" | "theorem";
  msc: string;
  wiki: string;
  summary: string;
}[] = [
  {
    slug: "parallel-postulate",
    title: "parallel postulate",
    type: "axiom",
    msc: "51M04",
    wiki: "https://en.wikipedia.org/wiki/Parallel_postulate",
    summary:
      "Euclid's fifth postulate: through a point not on a line there is exactly one parallel line — the axiom that separates Euclidean from non-Euclidean geometry.",
  },
  {
    slug: "bolzano-weierstrass",
    title: "Bolzano–Weierstrass theorem",
    type: "theorem",
    msc: "26A03",
    wiki: "https://en.wikipedia.org/wiki/Bolzano%E2%80%93Weierstrass_theorem",
    summary:
      "Every bounded sequence of real numbers has a convergent subsequence — a cornerstone of real analysis expressing the completeness of the reals.",
  },
  {
    slug: "weierstrass-approximation",
    title: "Weierstrass approximation theorem",
    type: "theorem",
    msc: "41A10",
    wiki: "https://en.wikipedia.org/wiki/Weierstrass_approximation_theorem",
    summary:
      "Every continuous function on a closed interval can be uniformly approximated by polynomials.",
  },
  {
    slug: "markov-inequality",
    title: "Markov's inequality",
    type: "theorem",
    msc: "60E15",
    wiki: "https://en.wikipedia.org/wiki/Markov%27s_inequality",
    summary:
      "The probability that a non-negative random variable exceeds a is at most its mean divided by a — the simplest tail bound.",
  },
  {
    slug: "euclid-theorem-primes",
    title: "Euclid's theorem",
    type: "theorem",
    msc: "11A41",
    wiki: "https://en.wikipedia.org/wiki/Euclid%27s_theorem",
    summary: "There are infinitely many prime numbers.",
  },
  {
    slug: "euler-criterion",
    title: "Euler's criterion",
    type: "theorem",
    msc: "11A15",
    wiki: "https://en.wikipedia.org/wiki/Euler%27s_criterion",
    summary:
      "Determines whether an integer is a quadratic residue modulo an odd prime via a^((p-1)/2) mod p.",
  },
  {
    slug: "inscribed-angle",
    title: "inscribed angle theorem",
    type: "theorem",
    msc: "51M04",
    wiki: "https://en.wikipedia.org/wiki/Inscribed_angle",
    summary:
      "An inscribed angle is half of the central angle subtending the same arc.",
  },
  {
    slug: "thales-theorem",
    title: "Thales's theorem",
    type: "theorem",
    msc: "51M04",
    wiki: "https://en.wikipedia.org/wiki/Thales%27s_theorem",
    summary:
      "An angle inscribed in a semicircle is a right angle — a special case of the inscribed angle theorem.",
  },
  {
    slug: "ptolemy-theorem",
    title: "Ptolemy's theorem",
    type: "theorem",
    msc: "51M04",
    wiki: "https://en.wikipedia.org/wiki/Ptolemy%27s_theorem",
    summary:
      "For a cyclic quadrilateral, the product of the diagonals equals the sum of the products of opposite sides.",
  },
  {
    slug: "heron-formula",
    title: "Heron's formula",
    type: "theorem",
    msc: "51M25",
    wiki: "https://en.wikipedia.org/wiki/Heron%27s_formula",
    summary:
      "The area of a triangle from its three side lengths alone.",
  },
  {
    slug: "pick-theorem",
    title: "Pick's theorem",
    type: "theorem",
    msc: "52B20",
    wiki: "https://en.wikipedia.org/wiki/Pick%27s_theorem",
    summary:
      "The area of a lattice polygon equals interior points plus half the boundary points minus one.",
  },
  {
    slug: "de-moivre-laplace",
    title: "de Moivre–Laplace theorem",
    type: "theorem",
    msc: "60F05",
    wiki: "https://en.wikipedia.org/wiki/De_Moivre%E2%80%93Laplace_theorem",
    summary:
      "The binomial distribution approaches the normal distribution — the historical seed of the central limit theorem.",
  },
  {
    slug: "am-gm-inequality",
    title: "inequality of arithmetic and geometric means",
    type: "theorem",
    msc: "26D15",
    wiki: "https://en.wikipedia.org/wiki/AM%E2%80%93GM_inequality",
    summary:
      "The arithmetic mean of non-negative reals is at least their geometric mean, with equality only when all are equal.",
  },
  {
    slug: "lax-milgram",
    title: "Lax–Milgram theorem",
    type: "theorem",
    msc: "35A15",
    wiki: "https://en.wikipedia.org/wiki/Weak_formulation#The_Lax%E2%80%93Milgram_theorem",
    summary:
      "Existence and uniqueness of weak solutions for coercive bounded bilinear forms on Hilbert spaces.",
  },
];

const DEPENDENCIES: [dependent: string, prerequisite: string][] = [
  // ---- set theory & foundations ---------------------------------------------
  ["Zorn's lemma", "axiom of choice"],
  ["well-ordering theorem", "axiom of choice"],
  ["Tychonoff's theorem", "axiom of choice"],
  ["Banach–Tarski paradox", "axiom of choice"],
  ["Hahn–Banach theorem", "Zorn's lemma"],
  ["Krull's theorem", "Zorn's lemma"],
  ["compactness theorem", "Gödel's completeness theorem"],
  ["Löwenheim–Skolem theorem", "compactness theorem"],
  ["Gödel's incompleteness theorems", "diagonal lemma"],
  ["Gödel's first incompleteness theorem", "diagonal lemma"],
  ["Gödel's second incompleteness theorem", "Gödel's first incompleteness theorem"],
  ["Tarski's undefinability theorem", "diagonal lemma"],
  ["Cantor's theorem", "Cantor's diagonal argument"],

  // ---- real analysis & calculus ----------------------------------------------
  ["Heine–Borel theorem", "Bolzano–Weierstrass theorem"],
  ["extreme value theorem", "Bolzano–Weierstrass theorem"],
  ["Rolle's theorem", "extreme value theorem"],
  ["mean value theorem", "Rolle's theorem"],
  ["fundamental theorem of calculus", "mean value theorem"],
  ["Taylor's theorem", "mean value theorem"],
  ["L'Hôpital's rule", "mean value theorem"],
  ["Arzelà–Ascoli theorem", "Bolzano–Weierstrass theorem"],
  ["Heine–Cantor theorem", "Heine–Borel theorem"],
  ["Stone–Weierstrass theorem", "Weierstrass approximation theorem"],
  ["inverse function theorem", "Banach fixed-point theorem"],
  ["implicit function theorem", "inverse function theorem"],
  ["Green's theorem", "fundamental theorem of calculus"],
  ["Stokes' theorem", "Green's theorem"],
  ["divergence theorem", "fundamental theorem of calculus"],

  // ---- inequalities ------------------------------------------------------------
  ["Hölder's inequality", "Young's inequality"],
  ["Minkowski inequality", "Hölder's inequality"],
  ["inequality of arithmetic and geometric means", "Jensen's inequality"],

  // ---- measure theory ------------------------------------------------------------
  ["Fatou's lemma", "monotone convergence theorem"],
  ["dominated convergence theorem", "Fatou's lemma"],
  ["Radon–Nikodym theorem", "Riesz representation theorem"],
  ["Lebesgue differentiation theorem", "Vitali covering lemma"],
  ["Lusin's theorem", "Egorov's theorem"],

  // ---- complex analysis -----------------------------------------------------------
  ["Cauchy's integral theorem", "Green's theorem"],
  ["Cauchy's integral formula", "Cauchy's integral theorem"],
  ["Liouville's theorem", "Cauchy's integral formula"],
  ["Liouville's theorem (complex analysis)", "Cauchy's integral formula"],
  ["fundamental theorem of algebra", "Liouville's theorem"],
  ["maximum modulus principle", "Cauchy's integral formula"],
  ["Schwarz lemma", "maximum modulus principle"],
  ["residue theorem", "Cauchy's integral theorem"],
  ["argument principle", "residue theorem"],
  ["Rouché's theorem", "argument principle"],
  ["open mapping theorem (complex analysis)", "Rouché's theorem"],
  ["Morera's theorem", "Cauchy's integral formula"],
  ["Montel's theorem", "Arzelà–Ascoli theorem"],
  ["Riemann mapping theorem", "Montel's theorem"],

  // ---- functional analysis -----------------------------------------------------------
  ["open mapping theorem (functional analysis)", "Baire category theorem"],
  ["closed graph theorem", "open mapping theorem (functional analysis)"],
  ["uniform boundedness principle", "Baire category theorem"],
  ["Banach–Alaoglu theorem", "Tychonoff's theorem"],
  ["Krein–Milman theorem", "Hahn–Banach theorem"],
  ["Lax–Milgram theorem", "Riesz representation theorem"],
  ["Plancherel theorem", "Parseval's theorem"],

  // ---- differential equations -----------------------------------------------------------
  ["Picard–Lindelöf theorem", "Banach fixed-point theorem"],
  ["Peano existence theorem", "Arzelà–Ascoli theorem"],

  // ---- number theory -----------------------------------------------------------
  ["Euclid's lemma", "Bézout's identity"],
  ["fundamental theorem of arithmetic", "Euclid's lemma"],
  ["Euclid's theorem", "fundamental theorem of arithmetic"],
  ["Chinese remainder theorem", "Bézout's identity"],
  ["Fermat's little theorem", "Lagrange's theorem (group theory)"],
  ["Euler's theorem", "Lagrange's theorem (group theory)"],
  ["Wilson's theorem", "Fermat's little theorem"],
  ["Euler's criterion", "Fermat's little theorem"],
  ["quadratic reciprocity", "Euler's criterion"],
  ["Lagrange's four-square theorem", "Minkowski's theorem"],
  ["Fermat's theorem on sums of two squares", "Minkowski's theorem"],
  ["Dirichlet's approximation theorem", "pigeonhole principle"],
  ["Fermat's Last Theorem", "modularity theorem"],
  ["Fermat's Last Theorem", "Ribet's theorem"],
  ["Green–Tao theorem", "Szemerédi's theorem"],

  // ---- algebra -----------------------------------------------------------
  ["Cauchy's theorem (group theory)", "Lagrange's theorem (group theory)"],
  ["Sylow theorems", "Cauchy's theorem (group theory)"],
  ["orbit-stabilizer theorem", "Lagrange's theorem (group theory)"],
  ["Burnside's lemma", "orbit-stabilizer theorem"],
  ["fundamental theorem of Galois theory", "primitive element theorem"],
  ["Abel–Ruffini theorem", "fundamental theorem of Galois theory"],
  [
    "fundamental theorem of finitely generated abelian groups",
    "structure theorem for finitely generated modules over a principal ideal domain",
  ],
  ["Hilbert's Nullstellensatz", "Noether normalization lemma"],

  // ---- geometry -----------------------------------------------------------
  ["Pythagorean theorem", "parallel postulate"],
  ["law of cosines", "Pythagorean theorem"],
  ["Heron's formula", "law of cosines"],
  ["Thales's theorem", "inscribed angle theorem"],
  ["Ptolemy's theorem", "inscribed angle theorem"],
  ["law of sines", "inscribed angle theorem"],
  ["Ceva's theorem", "Menelaus's theorem"],
  ["Pick's theorem", "Euler's polyhedron formula"],
  ["Pythagorean trigonometric identity", "Pythagorean theorem"],

  // ---- topology -----------------------------------------------------------
  ["Brouwer fixed-point theorem", "Sperner's lemma"],
  ["Jordan curve theorem", "Brouwer fixed-point theorem"],
  ["invariance of domain", "Brouwer fixed-point theorem"],
  ["ham sandwich theorem", "Borsuk–Ulam theorem"],
  ["hairy ball theorem", "Poincaré–Hopf theorem"],
  ["Poincaré conjecture", "geometrization conjecture"],

  // ---- combinatorics & graph theory --------------------------------------------
  ["Ramsey's theorem", "pigeonhole principle"],
  ["Erdős–Szekeres theorem", "pigeonhole principle"],
  ["König's theorem (graph theory)", "Hall's marriage theorem"],
  ["Dilworth's theorem", "König's theorem (graph theory)"],
  ["Szemerédi's theorem", "Szemerédi regularity lemma"],
  ["Cayley's formula", "Kirchhoff's theorem"],
  ["five color theorem", "Euler's polyhedron formula"],

  // ---- probability & statistics --------------------------------------------------
  ["Chebyshev's inequality", "Markov's inequality"],
  ["law of large numbers", "Chebyshev's inequality"],
  ["central limit theorem", "Lévy's continuity theorem"],
  ["Donsker's theorem", "central limit theorem"],
  ["de Moivre–Laplace theorem", "Stirling's approximation"],
];

/** Normalize a title for matching: case, dash/apostrophe variants, diacritics. */
function norm(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’ʼ`]/g, "'")
    .replace(/[–—−]/g, "-")
    // canonicalize possessives: "Menelaus' theorem" -> "Menelaus's theorem"
    .replace(/s'(\s)/g, "s's$1")
    .replace(/\s+/g, " ")
    .replace(/^the /, "")
    .trim();
}

const stripParen = (s: string) => s.replace(/\s*\([^)]*\)\s*$/, "").trim();

async function main() {
  const db = await getDb();

  // ---- seed famous nodes missing from the Wikidata harvest -------------------
  // Idempotent: wipe previous seeds and recreate.
  await db.delete(schema.edges).where(
    or(like(schema.edges.source, "seed:%"), like(schema.edges.target, "seed:%")),
  );
  await db.delete(schema.nodes).where(like(schema.nodes.id, "seed:%"));

  const mscNodes = await db
    .select({ id: schema.nodes.id, mscCode: schema.nodes.mscCode })
    .from(schema.nodes)
    .where(like(schema.nodes.id, "msc:%"));
  const byCode = new Map(mscNodes.map((n) => [n.mscCode!, n.id]));
  const resolveMsc = (code: string): string | null =>
    byCode.get(code) ??
    byCode.get(`${code.slice(0, 3)}xx`) ??
    byCode.get(`${code.slice(0, 2)}-XX`) ??
    null;

  const existingTitles = new Set(
    (
      await db
        .select({ title: schema.nodes.title })
        .from(schema.nodes)
        .where(inArray(schema.nodes.type, ["axiom", "theorem", "conjecture"]))
    ).map((n) => norm(n.title)),
  );

  let seeded = 0;
  for (const s of SEED_ENTITIES) {
    if (existingTitles.has(norm(s.title))) continue; // Wikidata already has it
    const parentId = resolveMsc(s.msc);
    if (!parentId) {
      console.warn(`  seed ${s.title}: no MSC parent for ${s.msc}, skipped`);
      continue;
    }
    const id = `seed:${s.slug}`;
    await db.insert(schema.nodes).values({
      id,
      type: s.type,
      title: s.title,
      summary: s.summary,
      wikipediaUrl: s.wiki,
      depth: 4,
      parentId,
    });
    await db.insert(schema.edges).values({ source: id, target: parentId, type: "child-of" });
    seeded++;
  }
  console.log(`Seeded ${seeded} curated entities`);

  const entityNodes = await db
    .select({ id: schema.nodes.id, title: schema.nodes.title })
    .from(schema.nodes)
    .where(inArray(schema.nodes.type, ["axiom", "theorem", "conjecture"]));
  console.log(`${entityNodes.length} entity nodes loaded`);

  // exact-title map plus an unambiguous parenthetical-stripped fallback
  const byTitle = new Map<string, string>();
  const byStripped = new Map<string, string | null>(); // null = ambiguous
  for (const n of entityNodes) {
    const t = norm(n.title);
    if (!byTitle.has(t)) byTitle.set(t, n.id);
    const s = stripParen(t);
    if (s !== t) {
      byStripped.set(s, byStripped.has(s) ? null : n.id);
    }
  }

  const resolve = (title: string): string | null => {
    const t = norm(title);
    return (
      byTitle.get(t) ??
      byTitle.get(stripParen(t)) ??
      byStripped.get(t) ??
      byStripped.get(stripParen(t)) ??
      null
    );
  };

  const existing = await db
    .select({ source: schema.edges.source, target: schema.edges.target })
    .from(schema.edges)
    .where(eq(schema.edges.type, "depends-on"));
  const have = new Set(existing.map((e) => `${e.source} ${e.target}`));

  const misses: string[] = [];
  const rows: (typeof schema.edges.$inferInsert)[] = [];
  const added = new Set<string>();
  for (const [dependent, prerequisite] of DEPENDENCIES) {
    const source = resolve(dependent);
    const target = resolve(prerequisite);
    if (!source) misses.push(dependent);
    if (!target) misses.push(prerequisite);
    if (!source || !target || source === target) continue;
    const key = `${source} ${target}`;
    if (have.has(key) || added.has(key)) continue;
    added.add(key);
    rows.push({ source, target, type: "depends-on" });
  }

  // Remove previously curated edges that are being re-inserted is unnecessary
  // (we skip existing pairs), so this script is safely re-runnable.
  for (const batch of chunk(rows, 500)) {
    await db.insert(schema.edges).values(batch);
  }

  const uniqueMisses = [...new Set(misses)];
  console.log(`Inserted ${rows.length} curated dependency edges`);
  if (uniqueMisses.length > 0) {
    console.log(`Unmatched titles (${uniqueMisses.length}):`);
    for (const m of uniqueMisses) console.log(`  - ${m}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
