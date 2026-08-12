/**
 * Curated derivation edges between named results.
 *
 * Wikidata's dependency properties (P3452 "inferred from", P144 "based on",
 * P737 "influenced by", P2283 "uses") are almost empty for mathematics — the
 * previous ingest found under a dozen usable links. This file encodes the
 * classic derivation chains you'd find in a standard curriculum: which axioms
 * and theorems each famous result's standard proof builds on.
 *
 * Each entry is [dependent, prerequisite, note] — the proof of the first uses
 * the second, and the note says how. Stored as edges {source: dependent,
 * target: prerequisite, type: "depends-on", note}, matching the Wikidata
 * ingest convention.
 *
 * Matching is by (normalized) title against axiom/theorem/conjecture nodes.
 * Unmatched titles are logged and skipped, so this list can safely be more
 * ambitious than the current dataset.
 *
 * Usage: npm run ingest:deps   (run after ingest:wikidata)
 */
import { and, eq, inArray, like, or } from "drizzle-orm";
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
  type: "axiom" | "theorem" | "conjecture" | "definition";
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
  {
    slug: "least-upper-bound-property",
    title: "least upper bound property",
    type: "axiom",
    msc: "26A03",
    wiki: "https://en.wikipedia.org/wiki/Least-upper-bound_property",
    summary:
      "The completeness axiom of the real numbers: every non-empty set bounded above has a supremum. The root of real analysis — Bolzano–Weierstrass, Heine–Borel, and the intermediate value theorem all flow from it.",
  },
  {
    slug: "fermat-stationary-points",
    title: "Fermat's theorem (stationary points)",
    type: "theorem",
    msc: "26A24",
    wiki: "https://en.wikipedia.org/wiki/Fermat%27s_theorem_(stationary_points)",
    summary:
      "At an interior local extremum of a differentiable function the derivative vanishes — the step from the extreme value theorem to Rolle's theorem.",
  },
  {
    slug: "cauchy-schwarz",
    title: "Cauchy–Schwarz inequality",
    type: "theorem",
    msc: "26D15",
    wiki: "https://en.wikipedia.org/wiki/Cauchy%E2%80%93Schwarz_inequality",
    summary:
      "|⟨u,v⟩| ≤ ‖u‖‖v‖ in any inner product space — arguably the most used inequality in mathematics.",
  },
  {
    slug: "bessel-inequality",
    title: "Bessel's inequality",
    type: "theorem",
    msc: "46C05",
    wiki: "https://en.wikipedia.org/wiki/Bessel%27s_inequality",
    summary:
      "The sum of squared Fourier coefficients against an orthonormal system is bounded by the squared norm.",
  },
  {
    slug: "hilbert-projection",
    title: "Hilbert projection theorem",
    type: "theorem",
    msc: "46C05",
    wiki: "https://en.wikipedia.org/wiki/Hilbert_projection_theorem",
    summary:
      "Every point has a unique nearest point in a closed convex subset of a Hilbert space — the key step toward the Riesz representation theorem.",
  },
  {
    slug: "chernoff-bound",
    title: "Chernoff bound",
    type: "theorem",
    msc: "60E15",
    wiki: "https://en.wikipedia.org/wiki/Chernoff_bound",
    summary:
      "Exponential tail bounds obtained by applying Markov's inequality to the moment generating function.",
  },
  {
    slug: "blichfeldt-theorem",
    title: "Blichfeldt's theorem",
    type: "theorem",
    msc: "11H06",
    wiki: "https://en.wikipedia.org/wiki/Blichfeldt%27s_theorem",
    summary:
      "A region of volume greater than the lattice determinant contains two points differing by a lattice vector — the pigeonhole step behind Minkowski's theorem.",
  },
  {
    slug: "euler-product",
    title: "Euler product formula",
    type: "theorem",
    msc: "11M06",
    wiki: "https://en.wikipedia.org/wiki/Euler_product",
    summary:
      "The Riemann zeta function factors as a product over primes — the analytic form of unique factorization.",
  },
  {
    slug: "bezout-identity",
    title: "Bézout's identity",
    type: "theorem",
    msc: "11A05",
    wiki: "https://en.wikipedia.org/wiki/B%C3%A9zout%27s_identity",
    summary:
      "gcd(a,b) is an integer combination ax + by — the output of the extended Euclidean algorithm and the engine of elementary number theory.",
  },
  {
    slug: "law-of-cosines",
    title: "law of cosines",
    type: "theorem",
    msc: "51M04",
    wiki: "https://en.wikipedia.org/wiki/Law_of_cosines",
    summary:
      "c² = a² + b² − 2ab·cos C — the Pythagorean theorem generalized to arbitrary triangles.",
  },
  {
    slug: "stirling-approximation",
    title: "Stirling's approximation",
    type: "theorem",
    msc: "41A60",
    wiki: "https://en.wikipedia.org/wiki/Stirling%27s_approximation",
    summary: "n! grows like √(2πn)(n/e)ⁿ.",
  },
  {
    slug: "pigeonhole-principle",
    title: "pigeonhole principle",
    type: "theorem",
    msc: "05A05",
    wiki: "https://en.wikipedia.org/wiki/Pigeonhole_principle",
    summary:
      "Placing more than n items into n boxes puts two in one box — the simplest counting argument, powering Ramsey theory and Diophantine approximation.",
  },
  {
    slug: "diagonal-lemma",
    title: "diagonal lemma",
    type: "theorem",
    msc: "03F40",
    wiki: "https://en.wikipedia.org/wiki/Diagonal_lemma",
    summary:
      "Every formula has a fixed point asserting its own property of itself — the self-reference engine behind Gödel's incompleteness theorems.",
  },
  {
    slug: "young-inequality",
    title: "Young's inequality",
    type: "theorem",
    msc: "26D15",
    wiki: "https://en.wikipedia.org/wiki/Young%27s_inequality_for_products",
    summary: "ab ≤ aᵖ/p + b^q/q for conjugate exponents — the seed of Hölder's inequality.",
  },
  {
    slug: "monotone-convergence",
    title: "monotone convergence theorem",
    type: "theorem",
    msc: "28A20",
    wiki: "https://en.wikipedia.org/wiki/Monotone_convergence_theorem",
    summary:
      "Increasing sequences of non-negative measurable functions can be integrated term by term.",
  },
  {
    slug: "gronwall-inequality",
    title: "Grönwall's inequality",
    type: "theorem",
    msc: "26D10",
    wiki: "https://en.wikipedia.org/wiki/Gr%C3%B6nwall%27s_inequality",
    summary:
      "A function bounded by an integral of itself is bounded by the corresponding exponential — the uniqueness engine for differential equations.",
  },
  {
    slug: "class-equation",
    title: "class equation",
    type: "theorem",
    msc: "20E45",
    wiki: "https://en.wikipedia.org/wiki/Conjugacy_class#Conjugacy_class_equation",
    summary:
      "|G| equals the center's size plus the sizes of the nontrivial conjugacy classes — counting a group by its conjugation action.",
  },
  {
    slug: "vitali-covering",
    title: "Vitali covering lemma",
    type: "theorem",
    msc: "28A75",
    wiki: "https://en.wikipedia.org/wiki/Vitali_covering_lemma",
    summary:
      "From any fine cover by balls one can select a disjoint subfamily whose enlargements still cover — the geometric core of differentiation theory.",
  },
  {
    slug: "jensen-inequality",
    title: "Jensen's inequality",
    type: "theorem",
    msc: "26D15",
    wiki: "https://en.wikipedia.org/wiki/Jensen%27s_inequality",
    summary: "A convex function of an average is at most the average of the function.",
  },
  {
    slug: "integration-by-parts",
    title: "integration by parts",
    type: "theorem",
    msc: "26A06",
    wiki: "https://en.wikipedia.org/wiki/Integration_by_parts",
    summary:
      "∫u dv = uv − ∫v du — the product rule read backwards through the fundamental theorem of calculus.",
  },
  {
    slug: "hoeffding-inequality",
    title: "Hoeffding's inequality",
    type: "theorem",
    msc: "60E15",
    wiki: "https://en.wikipedia.org/wiki/Hoeffding%27s_inequality",
    summary:
      "Sums of bounded independent random variables concentrate exponentially around their mean.",
  },
  {
    slug: "azuma-inequality",
    title: "Azuma's inequality",
    type: "theorem",
    msc: "60G42",
    wiki: "https://en.wikipedia.org/wiki/Azuma%27s_inequality",
    summary:
      "The martingale version of Hoeffding's inequality: bounded-difference martingales concentrate exponentially.",
  },
  {
    slug: "strong-law-large-numbers",
    title: "strong law of large numbers",
    type: "theorem",
    msc: "60F15",
    wiki: "https://en.wikipedia.org/wiki/Law_of_large_numbers#Strong_law",
    summary:
      "Sample averages of i.i.d. integrable variables converge almost surely to the mean.",
  },
  {
    slug: "cramer-rao",
    title: "Cramér–Rao bound",
    type: "theorem",
    msc: "62F10",
    wiki: "https://en.wikipedia.org/wiki/Cram%C3%A9r%E2%80%93Rao_bound",
    summary:
      "No unbiased estimator can beat the inverse Fisher information — the fundamental precision limit of estimation.",
  },
  {
    slug: "jordan-holder",
    title: "Jordan–Hölder theorem",
    type: "theorem",
    msc: "20E15",
    wiki: "https://en.wikipedia.org/wiki/Composition_series#Jordan%E2%80%93H%C3%B6lder_theorem",
    summary:
      "Any two composition series of a group have the same factors up to order — groups have well-defined 'prime factorizations'.",
  },
  {
    slug: "nakayama-lemma",
    title: "Nakayama's lemma",
    type: "theorem",
    msc: "13C12",
    wiki: "https://en.wikipedia.org/wiki/Nakayama%27s_lemma",
    summary:
      "A finitely generated module killed by the Jacobson radical is zero — the workhorse of commutative algebra.",
  },
  {
    slug: "svd",
    title: "singular value decomposition",
    type: "theorem",
    msc: "15A18",
    wiki: "https://en.wikipedia.org/wiki/Singular_value_decomposition",
    summary:
      "Every matrix factors as rotation · scaling · rotation — the geometric normal form behind least squares and PCA.",
  },
  {
    slug: "polar-decomposition",
    title: "polar decomposition",
    type: "theorem",
    msc: "15A23",
    wiki: "https://en.wikipedia.org/wiki/Polar_decomposition",
    summary: "Every operator factors as a partial isometry times a positive operator.",
  },
  {
    slug: "schauder-fixed-point",
    title: "Schauder fixed-point theorem",
    type: "theorem",
    msc: "47H10",
    wiki: "https://en.wikipedia.org/wiki/Schauder_fixed-point_theorem",
    summary:
      "Brouwer's fixed point theorem extended to compact convex sets in Banach spaces.",
  },
  {
    slug: "stewart-theorem",
    title: "Stewart's theorem",
    type: "theorem",
    msc: "51M04",
    wiki: "https://en.wikipedia.org/wiki/Stewart%27s_theorem",
    summary: "Relates a cevian's length to the triangle's sides — the law of cosines applied twice.",
  },
  {
    slug: "intersecting-chords",
    title: "intersecting chords theorem",
    type: "theorem",
    msc: "51M04",
    wiki: "https://en.wikipedia.org/wiki/Intersecting_chords_theorem",
    summary:
      "Two chords crossing inside a circle cut each other into segments with equal products.",
  },
  {
    slug: "power-of-a-point",
    title: "power of a point",
    type: "theorem",
    msc: "51M04",
    wiki: "https://en.wikipedia.org/wiki/Power_of_a_point",
    summary:
      "The product of signed distances from a point to a circle along any line through it is constant.",
  },
  {
    slug: "urysohn-metrization",
    title: "Urysohn metrization theorem",
    type: "theorem",
    msc: "54E35",
    wiki: "https://en.wikipedia.org/wiki/Urysohn_metrization_theorem",
    summary: "Every second-countable regular Hausdorff space is metrizable.",
  },
  {
    slug: "axiom-dependent-choice",
    title: "axiom of dependent choice",
    type: "axiom",
    msc: "03E25",
    wiki: "https://en.wikipedia.org/wiki/Axiom_of_dependent_choice",
    summary:
      "One may make countably many successive choices — the fragment of choice that everyday analysis actually uses.",
  },
  {
    slug: "reciprocals-of-primes",
    title: "divergence of the sum of the reciprocals of the primes",
    type: "theorem",
    msc: "11N05",
    wiki: "https://en.wikipedia.org/wiki/Divergence_of_the_sum_of_the_reciprocals_of_the_primes",
    summary:
      "1/2 + 1/3 + 1/5 + 1/7 + … diverges — Euler's analytic proof that primes are plentiful.",
  },
  {
    slug: "halting-problem",
    title: "halting problem",
    type: "theorem",
    msc: "03D10",
    wiki: "https://en.wikipedia.org/wiki/Halting_problem",
    summary:
      "No algorithm decides whether an arbitrary program halts — Turing's diagonal argument.",
  },
  {
    slug: "rice-theorem",
    title: "Rice's theorem",
    type: "theorem",
    msc: "03D10",
    wiki: "https://en.wikipedia.org/wiki/Rice%27s_theorem",
    summary:
      "Every nontrivial semantic property of programs is undecidable — the halting problem, universalized.",
  },
  {
    slug: "los-theorem",
    title: "Łoś's theorem",
    type: "theorem",
    msc: "03C20",
    wiki: "https://en.wikipedia.org/wiki/Ultraproduct#%C5%81o%C5%9B's_theorem",
    summary:
      "A first-order sentence holds in an ultraproduct iff it holds in almost every factor.",
  },
  {
    slug: "hardy-littlewood-maximal",
    title: "Hardy–Littlewood maximal inequality",
    type: "theorem",
    msc: "42B25",
    wiki: "https://en.wikipedia.org/wiki/Hardy%E2%80%93Littlewood_maximal_function",
    summary:
      "The maximal average of an integrable function satisfies a weak (1,1) bound — the engine of differentiation theory.",
  },
  {
    slug: "smith-normal-form",
    title: "Smith normal form",
    type: "theorem",
    msc: "15A21",
    wiki: "https://en.wikipedia.org/wiki/Smith_normal_form",
    summary:
      "Every integer (or PID) matrix diagonalizes by row/column operations with divisibility along the diagonal.",
  },
  {
    slug: "jordan-normal-form",
    title: "Jordan normal form",
    type: "theorem",
    msc: "15A21",
    wiki: "https://en.wikipedia.org/wiki/Jordan_normal_form",
    summary:
      "Every complex matrix is similar to a block-diagonal matrix of Jordan blocks — the canonical form of a linear operator.",
  },
  {
    slug: "vieta-formulas",
    title: "Vieta's formulas",
    type: "theorem",
    msc: "12E05",
    wiki: "https://en.wikipedia.org/wiki/Vieta%27s_formulas",
    summary:
      "A polynomial's coefficients are the elementary symmetric functions of its roots.",
  },
  {
    slug: "rational-root-theorem",
    title: "rational root theorem",
    type: "theorem",
    msc: "12E05",
    wiki: "https://en.wikipedia.org/wiki/Rational_root_theorem",
    summary:
      "Any rational root p/q of an integer polynomial has p dividing the constant term and q the leading coefficient.",
  },
  {
    slug: "sperner-theorem",
    title: "Sperner's theorem",
    type: "theorem",
    msc: "05D05",
    wiki: "https://en.wikipedia.org/wiki/Sperner%27s_theorem",
    summary:
      "The largest antichain of subsets of an n-set is the middle binomial layer.",
  },
  {
    slug: "birkhoff-von-neumann",
    title: "Birkhoff–von Neumann theorem",
    type: "theorem",
    msc: "15B51",
    wiki: "https://en.wikipedia.org/wiki/Doubly_stochastic_matrix#Birkhoff%E2%80%93von_Neumann_theorem",
    summary:
      "Doubly stochastic matrices are exactly the convex combinations of permutation matrices.",
  },
  {
    slug: "cauchy-mvt",
    title: "Cauchy's mean value theorem",
    type: "theorem",
    msc: "26A24",
    wiki: "https://en.wikipedia.org/wiki/Mean_value_theorem#Cauchy's_mean_value_theorem",
    summary:
      "The generalized mean value theorem for a ratio of two functions — the step behind L'Hôpital's rule.",
  },
  {
    slug: "sobolev-embedding",
    title: "Sobolev embedding theorem",
    type: "theorem",
    msc: "46E35",
    wiki: "https://en.wikipedia.org/wiki/Sobolev_inequality",
    summary:
      "Sobolev spaces embed into Lebesgue or Hölder spaces depending on how derivatives trade against dimension.",
  },
  {
    slug: "doob-martingale-convergence",
    title: "Doob's martingale convergence theorem",
    type: "theorem",
    msc: "60G42",
    wiki: "https://en.wikipedia.org/wiki/Doob%27s_martingale_convergence_theorems",
    summary:
      "An L¹-bounded (super)martingale converges almost surely.",
  },
  {
    slug: "thom-transversality",
    title: "Thom transversality theorem",
    type: "theorem",
    msc: "57R35",
    wiki: "https://en.wikipedia.org/wiki/Transversality_theorem",
    summary:
      "Generic smooth maps are transverse to any given submanifold — genericity made precise via Sard's theorem.",
  },
  {
    slug: "craig-interpolation",
    title: "Craig interpolation theorem",
    type: "theorem",
    msc: "03C40",
    wiki: "https://en.wikipedia.org/wiki/Craig_interpolation",
    summary:
      "If A implies B, some interpolant in their shared vocabulary sits between them.",
  },
  {
    slug: "cut-elimination",
    title: "cut-elimination theorem",
    type: "theorem",
    msc: "03F05",
    wiki: "https://en.wikipedia.org/wiki/Cut-elimination_theorem",
    summary:
      "Gentzen's Hauptsatz: every sequent-calculus proof can be rewritten without the cut rule.",
  },
  {
    slug: "homotopy-type-theory",
    title: "homotopy type theory",
    type: "definition",
    msc: "03B38",
    wiki: "https://en.wikipedia.org/wiki/Homotopy_type_theory",
    summary:
      "A foundation for mathematics identifying types with spaces and equality with paths — univalent foundations linking type theory and homotopy theory.",
  },
  {
    slug: "p-versus-np",
    title: "P versus NP problem",
    type: "conjecture",
    msc: "68Q15",
    wiki: "https://en.wikipedia.org/wiki/P_versus_NP_problem",
    summary:
      "Whether every problem whose solutions can be verified quickly can also be solved quickly — the central open question of computational complexity.",
  },
  {
    slug: "chaos-theory",
    title: "chaos theory",
    type: "definition",
    msc: "37D45",
    wiki: "https://en.wikipedia.org/wiki/Chaos_theory",
    summary:
      "The study of deterministic dynamical systems that are highly sensitive to initial conditions, producing effectively unpredictable long-term behavior.",
  },
  {
    slug: "finite-element-method",
    title: "finite element method",
    type: "definition",
    msc: "65N30",
    wiki: "https://en.wikipedia.org/wiki/Finite_element_method",
    summary:
      "A numerical technique that approximates PDE solutions by piecewise polynomial functions on a mesh — the workhorse of computational science and engineering.",
  },
  {
    slug: "machine-learning",
    title: "machine learning",
    type: "definition",
    msc: "68T05",
    wiki: "https://en.wikipedia.org/wiki/Machine_learning",
    summary:
      "Algorithms that improve at a task from data rather than explicit programming — spanning statistical learning, optimization, and computational learning theory.",
  },
  {
    slug: "string-theory",
    title: "string theory",
    type: "definition",
    msc: "81T30",
    wiki: "https://en.wikipedia.org/wiki/String_theory",
    summary:
      "A framework in mathematical physics treating particles as vibrating one-dimensional strings, deeply tied to geometry, topology, and quantum field theory.",
  },
  {
    slug: "quantum-field-theory",
    title: "quantum field theory",
    type: "definition",
    msc: "81T13",
    wiki: "https://en.wikipedia.org/wiki/Quantum_field_theory",
    summary:
      "The synthesis of quantum mechanics and special relativity describing particles as excitations of fields — the language of the Standard Model and much of mathematical physics.",
  },
  {
    slug: "information-theory",
    title: "information theory",
    type: "definition",
    msc: "94A17",
    wiki: "https://en.wikipedia.org/wiki/Information_theory",
    summary:
      "The mathematical study of information quantification, storage, and communication, founded on Shannon entropy and channel capacity.",
  },
  {
    slug: "sheaf-theory",
    title: "sheaf theory",
    type: "definition",
    msc: "18F20",
    wiki: "https://en.wikipedia.org/wiki/Sheaf_(mathematics)",
    summary:
      "A tool for tracking locally defined data that glues consistently — central to algebraic geometry, topology, and modern category-theoretic mathematics.",
  },
  {
    // No Wikidata item; Wikipedia "G-conjecture" redirects to Simplicial sphere.
    slug: "g-conjecture",
    title: "g-conjecture",
    type: "theorem",
    msc: "52B05",
    wiki: "https://en.wikipedia.org/wiki/G-conjecture",
    summary:
      "McMullen's characterization of the face numbers (f-vectors) of simplicial spheres — the g-theorem for polytopes, extended to spheres by Adiprasito in 2018.",
  },
];

const DEPENDENCIES: [dependent: string, prerequisite: string, note?: string][] = [
  // ---- set theory & foundations ---------------------------------------------
  ["Zorn's lemma", "axiom of choice", "Zorn's lemma is equivalent to the axiom of choice; the standard proof builds a maximal chain by transfinite choice."],
  ["well-ordering theorem", "axiom of choice", "Zermelo derived the well-ordering theorem from the axiom of choice by transfinite recursion."],
  ["Tychonoff's theorem", "axiom of choice", "Tychonoff's theorem for arbitrary products is equivalent to the axiom of choice."],
  ["Banach–Tarski paradox", "axiom of choice", "The paradoxical pieces come from a non-measurable choice of orbit representatives, supplied by the axiom of choice."],
  ["Hahn–Banach theorem", "Zorn's lemma", "Extend the functional one dimension at a time; Zorn's lemma gives a maximal (hence total) extension."],
  ["Krull's theorem", "Zorn's lemma", "The union of a chain of proper ideals is proper, so Zorn's lemma produces a maximal ideal."],
  ["compactness theorem", "Gödel's completeness theorem", "A finitely satisfiable theory is finitely consistent, hence consistent, hence has a model by completeness."],
  ["Löwenheim–Skolem theorem", "compactness theorem", "The upward direction follows by applying compactness to the theory with many new constant symbols."],
  ["Gödel's incompleteness theorems", "diagonal lemma", "The diagonal lemma produces the self-referential sentence 'I am not provable' at the heart of the proof."],
  ["Gödel's first incompleteness theorem", "diagonal lemma", "The diagonal lemma produces the self-referential sentence 'I am not provable' at the heart of the proof."],
  ["Gödel's second incompleteness theorem", "Gödel's first incompleteness theorem", "Formalizing the first theorem's proof inside arithmetic shows consistency implies the unprovable sentence."],
  ["Tarski's undefinability theorem", "diagonal lemma", "A definable truth predicate would let the diagonal lemma build a liar sentence, a contradiction."],
  ["Cantor's theorem", "Cantor's diagonal argument", "Given any map from a set to its power set, diagonalization exhibits a subset missed by the map."],

  // ---- real analysis & calculus ----------------------------------------------
  // the completeness axiom is the root of the whole tree
  ["Bolzano–Weierstrass theorem", "least upper bound property", "Completeness makes the bisection (or monotone subsequence) argument converge to a limit point."],
  ["Heine–Borel theorem", "least upper bound property", "Take the supremum of points reachable by a finite subcover; completeness pushes it to the end of the interval."],
  ["intermediate value theorem", "least upper bound property", "The supremum of points where f stays below the target is where continuity forces equality."],
  ["Heine–Borel theorem", "Bolzano–Weierstrass theorem", "If no finite subcover existed, a sequence of bad points would have a limit point that breaks the cover."],
  ["extreme value theorem", "Bolzano–Weierstrass theorem", "A maximizing sequence has a convergent subsequence whose limit attains the supremum."],
  ["Fermat's theorem (stationary points)", "extreme value theorem", "The extreme value theorem supplies the interior extremum at which the derivative must vanish."],
  ["Rolle's theorem", "Fermat's theorem (stationary points)", "The extremum inside the interval is a stationary point by Fermat's theorem, giving f' = 0."],
  ["mean value theorem", "Rolle's theorem", "Subtract the secant line; Rolle's theorem applied to the difference gives the mean value point."],
  ["Darboux's theorem", "intermediate value theorem", "Derivatives take intermediate values; the proof runs an IVT-style argument on an auxiliary extremum."],
  ["integration by parts", "fundamental theorem of calculus", "Integrate the product rule and apply the fundamental theorem of calculus."],
  ["fundamental theorem of calculus", "mean value theorem", "The mean value theorem controls the difference quotients of the accumulation function."],
  ["Taylor's theorem", "mean value theorem", "The Lagrange remainder comes from repeated application of the (Cauchy) mean value theorem."],
  ["L'Hôpital's rule", "mean value theorem", "Cauchy's form of the mean value theorem compares f and g on shrinking intervals."],
  ["Arzelà–Ascoli theorem", "Bolzano–Weierstrass theorem", "A diagonal argument extracts convergent subsequences using Bolzano–Weierstrass at each rational point."],
  ["Heine–Cantor theorem", "Heine–Borel theorem", "Compactness (finite subcovers) turns pointwise continuity into uniform continuity."],
  ["Stone–Weierstrass theorem", "Weierstrass approximation theorem", "The lattice argument reduces to approximating |x| by polynomials — the classical Weierstrass case."],
  ["inverse function theorem", "Banach fixed-point theorem", "The local inverse is the fixed point of a contraction built from the linearization."],
  ["implicit function theorem", "inverse function theorem", "Apply the inverse function theorem to the map (x, y) ↦ (x, f(x, y)) and read off the solution."],
  ["Green's theorem", "fundamental theorem of calculus", "Slice the region and apply the fundamental theorem of calculus in each variable."],
  ["Stokes' theorem", "Green's theorem", "In each coordinate chart, pulling back to the plane reduces Stokes' theorem to Green's theorem."],
  ["divergence theorem", "fundamental theorem of calculus", "Integrate each partial derivative along its own axis — the fundamental theorem coordinate by coordinate."],

  // ---- inequalities ------------------------------------------------------------
  ["Hölder's inequality", "Young's inequality", "Normalize and apply Young's inequality ab ≤ aᵖ/p + bᵍ/q pointwise, then integrate."],
  ["Minkowski inequality", "Hölder's inequality", "Split |f+g|ᵖ ≤ |f+g|ᵖ⁻¹(|f|+|g|) and apply Hölder to each term."],
  ["inequality of arithmetic and geometric means", "Jensen's inequality", "Apply Jensen's inequality to the concave logarithm."],
  ["Bessel's inequality", "Cauchy–Schwarz inequality", "Expanding ‖f − Σ⟨f,eₖ⟩eₖ‖² ≥ 0 in the inner product bounds the coefficient sums."],
  ["Parseval's theorem", "Bessel's inequality", "Parseval upgrades Bessel's inequality to equality when the orthonormal system is complete."],
  ["Cramér–Rao bound", "Cauchy–Schwarz inequality", "The variance bound is Cauchy–Schwarz applied to the estimator and the score function."],

  // ---- measure theory ------------------------------------------------------------
  ["Fatou's lemma", "monotone convergence theorem", "Apply monotone convergence to the increasing sequence of infima."],
  ["dominated convergence theorem", "Fatou's lemma", "Fatou's lemma applied to g ± fₙ squeezes the limit from both sides."],
  ["Fubini's theorem", "monotone convergence theorem", "Monotone convergence lifts the product formula from simple functions to integrable ones."],
  ["Tonelli's theorem", "monotone convergence theorem", "Monotone convergence lifts the identity from simple functions to all non-negative measurable functions."],
  ["Radon–Nikodym theorem", "Riesz representation theorem", "Von Neumann's proof obtains the density from the Riesz representation of a functional on L²."],
  ["Lebesgue differentiation theorem", "Vitali covering lemma", "Vitali's covering lemma controls the measure of the set where averages misbehave."],
  ["Lusin's theorem", "Egorov's theorem", "Egorov turns a.e. convergence of simple approximations into uniform convergence off a small set."],

  // ---- complex analysis -----------------------------------------------------------
  ["Cauchy's integral theorem", "Green's theorem", "For C¹ integrands, Green's theorem plus the Cauchy–Riemann equations makes the contour integral vanish."],
  ["Cauchy's integral formula", "Cauchy's integral theorem", "Shrink the contour to a small circle around the point; the integral theorem kills the rest."],
  ["Liouville's theorem", "Cauchy's integral formula", "The integral formula bounds f'(z) by sup|f|/R, which tends to zero for a bounded entire function."],
  ["Liouville's theorem (complex analysis)", "Cauchy's integral formula", "The integral formula bounds f'(z) by sup|f|/R, which tends to zero for a bounded entire function."],
  ["fundamental theorem of algebra", "Liouville's theorem", "If p had no root, 1/p would be a bounded entire function, hence constant — a contradiction."],
  ["maximum modulus principle", "Cauchy's integral formula", "The mean value property from the integral formula forbids strict interior maxima."],
  ["Schwarz lemma", "maximum modulus principle", "Apply the maximum principle to f(z)/z on shrinking disks."],
  ["residue theorem", "Cauchy's integral theorem", "Deform the contour into small circles around each singularity; the theorem handles the rest."],
  ["argument principle", "residue theorem", "Zeros and poles are counted as residues of f'/f."],
  ["Rouché's theorem", "argument principle", "A homotopy leaves the winding number — counted by the argument principle — unchanged."],
  ["open mapping theorem (complex analysis)", "Rouché's theorem", "Rouché's theorem shows every value near f(z₀) is attained, so images of disks contain disks."],
  ["Morera's theorem", "Cauchy's integral formula", "Vanishing contour integrals give a holomorphic primitive; differentiating recovers f as analytic."],
  ["Montel's theorem", "Arzelà–Ascoli theorem", "Cauchy estimates turn local boundedness into equicontinuity, so Arzelà–Ascoli applies."],
  ["Riemann mapping theorem", "Montel's theorem", "An extremal sequence of injective maps converges locally uniformly by Montel's normality."],

  // ---- functional analysis -----------------------------------------------------------
  ["open mapping theorem (functional analysis)", "Baire category theorem", "Baire category finds a ball inside the closure of the image of the unit ball; completeness removes the closure."],
  ["closed graph theorem", "open mapping theorem (functional analysis)", "Apply the open mapping theorem to the projection from the (closed) graph onto the domain."],
  ["uniform boundedness principle", "Baire category theorem", "The sets where the family is bounded by n cannot all be nowhere dense in a complete space."],
  ["Banach–Alaoglu theorem", "Tychonoff's theorem", "The dual ball embeds into a product of compact discs, compact by Tychonoff."],
  ["Krein–Milman theorem", "Hahn–Banach theorem", "Hahn–Banach separating hyperplanes carve compact convex sets down to extreme points."],
  ["Lax–Milgram theorem", "Riesz representation theorem", "Represent the bilinear form by an operator via Riesz, then invert it using coercivity."],
  ["Plancherel theorem", "Parseval's theorem", "Extends Parseval's identity from a dense subspace to all of L² by continuity."],
  ["Riesz representation theorem", "Hilbert projection theorem", "Project onto the complement of the kernel to find the representing vector."],
  ["spectral theorem", "Stone–Weierstrass theorem", "The continuous functional calculus is built by approximating functions of the operator with polynomials."],
  ["singular value decomposition", "spectral theorem", "Diagonalize A*A by the spectral theorem; its eigenvectors are the right singular vectors."],
  ["polar decomposition", "singular value decomposition", "Regroup the SVD factors as (unitary)·(positive semidefinite)."],

  // ---- fixed points -----------------------------------------------------------
  ["Schauder fixed-point theorem", "Brouwer fixed-point theorem", "Finite-dimensional projections reduce the compact convex case to Brouwer's theorem."],
  ["Kakutani fixed-point theorem", "Brouwer fixed-point theorem", "Approximate the correspondence by continuous selections and apply Brouwer to each."],
  ["Perron–Frobenius theorem", "Brouwer fixed-point theorem", "The normalized positive matrix maps the simplex to itself; a fixed point is the positive eigenvector."],
  ["minimax theorem", "Brouwer fixed-point theorem", "Von Neumann's original proof located the equilibrium with a fixed-point argument."],

  // ---- differential equations -----------------------------------------------------------
  ["Picard–Lindelöf theorem", "Banach fixed-point theorem", "The Picard iteration map is a contraction on a short time interval, so it has a unique fixed point."],
  ["Picard–Lindelöf theorem", "Grönwall's inequality", "Grönwall's inequality forces any two solutions to coincide, giving uniqueness."],
  ["Peano existence theorem", "Arzelà–Ascoli theorem", "Euler polygon approximations are equicontinuous; Arzelà–Ascoli extracts a converging solution."],

  // ---- number theory -----------------------------------------------------------
  ["Euclid's lemma", "Bézout's identity", "If p divides ab but not a, write 1 = ax + py and multiply by b to see p | b."],
  ["Minkowski's theorem", "Blichfeldt's theorem", "Blichfeldt gives two points of the half-scaled body differing by a lattice vector; convexity finishes."],
  ["Blichfeldt's theorem", "pigeonhole principle", "Translate the region into one fundamental domain; volume exceeding the domain forces an overlap."],
  ["Dirichlet's unit theorem", "Minkowski's theorem", "Minkowski's lattice-point theorem supplies units realizing each sign pattern in the logarithmic embedding."],
  ["Euler product formula", "fundamental theorem of arithmetic", "Expanding the product over primes enumerates every integer exactly once by unique factorization."],
  ["divergence of the sum of the reciprocals of the primes", "Euler product formula", "Taking logarithms of the divergent Euler product as s → 1 bounds Σ 1/p from below."],
  ["prime number theorem", "Cauchy's integral theorem", "Newman's proof evaluates a contour integral over the zero-free region of the zeta function."],
  ["fundamental theorem of arithmetic", "Euclid's lemma", "Euclid's lemma powers the induction that proves uniqueness of prime factorization."],
  ["Euclid's theorem", "fundamental theorem of arithmetic", "p₁⋯pₖ + 1 has a prime factor, and unique factorization says it lies outside any finite list."],
  ["Chinese remainder theorem", "Bézout's identity", "Bézout coefficients for the coprime moduli build the idempotents that glue the congruences."],
  ["Fermat's little theorem", "Lagrange's theorem (group theory)", "The multiplicative group mod p has order p − 1, so every element's order divides it."],
  ["Euler's theorem", "Lagrange's theorem (group theory)", "Same argument in the group of units mod n, which has order φ(n)."],
  ["Wilson's theorem", "Fermat's little theorem", "Pair each factor of (p−1)! with its inverse; the polynomial proof runs through Fermat's little theorem."],
  ["Euler's criterion", "Fermat's little theorem", "a^(p−1) = 1 has square roots ±1; the criterion identifies which one a^((p−1)/2) is."],
  ["quadratic reciprocity", "Euler's criterion", "Gauss's classical proofs manipulate the ±1 values given by Euler's criterion."],
  ["Lagrange's four-square theorem", "Minkowski's theorem", "The geometry-of-numbers proof finds a short vector in a lattice built from quaternion congruences."],
  ["Fermat's theorem on sums of two squares", "Minkowski's theorem", "A short vector in the lattice built from a square root of −1 mod p gives x² + y² = p."],
  ["Dirichlet's approximation theorem", "pigeonhole principle", "Split [0,1) into N boxes; two of the multiples of α must share one."],
  ["Fermat's Last Theorem", "modularity theorem", "Wiles proved modularity of semistable elliptic curves, which a Fermat counterexample would violate."],
  ["Fermat's Last Theorem", "Ribet's theorem", "Ribet showed the Frey curve of a counterexample could not be modular — closing the trap."],
  ["Green–Tao theorem", "Szemerédi's theorem", "A relative Szemerédi theorem is applied inside a pseudorandom majorant of the primes."],

  // ---- algebra -----------------------------------------------------------
  ["Cauchy's theorem (group theory)", "Lagrange's theorem (group theory)", "The counting argument works against Lagrange's constraint that orders divide |G|."],
  ["Cauchy's theorem (group theory)", "class equation", "The classical induction runs through the class equation to reach the center."],
  ["class equation", "orbit-stabilizer theorem", "Conjugacy class sizes are indices of centralizers, by orbit–stabilizer for the conjugation action."],
  ["Sylow theorems", "Cauchy's theorem (group theory)", "The induction building maximal p-subgroups starts from Cauchy's element of order p."],
  ["orbit-stabilizer theorem", "Lagrange's theorem (group theory)", "Cosets of the stabilizer biject with the orbit, so |orbit| · |stabilizer| = |G|."],
  ["Burnside's lemma", "orbit-stabilizer theorem", "Count pairs (g, x) with g·x = x two ways; orbit–stabilizer converts the sum into orbit counts."],
  ["Schreier refinement theorem", "Zassenhaus lemma", "The butterfly lemma matches successive quotients of the two refined series."],
  ["Jordan–Hölder theorem", "Schreier refinement theorem", "Refine both composition series; Schreier's theorem makes the refinements equivalent."],
  ["Artin–Wedderburn theorem", "Schur's lemma", "Endomorphism rings of the simple modules are division rings by Schur's lemma."],
  ["Nakayama's lemma", "Cayley–Hamilton theorem", "The determinant trick — Cayley–Hamilton for module endomorphisms — produces the annihilating element."],
  ["Eisenstein's criterion", "Gauss's lemma (polynomials)", "Gauss's lemma reduces irreducibility over ℚ to irreducibility over ℤ, where the p-adic argument runs."],
  ["fundamental theorem of Galois theory", "primitive element theorem", "The primitive element theorem makes the extension simple, keying the subgroup–subfield correspondence."],
  ["Abel–Ruffini theorem", "fundamental theorem of Galois theory", "Solvability by radicals forces a solvable Galois group, but the generic quintic has group S₅."],
  [
    "fundamental theorem of finitely generated abelian groups",
    "structure theorem for finitely generated modules over a principal ideal domain",
    "Specialize the PID structure theorem to modules over ℤ.",
  ],
  ["Hilbert's Nullstellensatz", "Noether normalization lemma", "Noether normalization reduces the statement to finite extensions of polynomial rings."],

  // ---- geometry -----------------------------------------------------------
  ["Pythagorean theorem", "parallel postulate", "The similar-triangle and area proofs need Euclidean angle sums — equivalent to the fifth postulate."],
  ["law of cosines", "Pythagorean theorem", "Drop an altitude and apply Pythagoras to the two right triangles."],
  ["Heron's formula", "law of cosines", "Substitute cos C from the law of cosines into Area = ½ab·sin C and simplify."],
  ["Stewart's theorem", "law of cosines", "Apply the law of cosines at the cevian's foot to both sub-triangles and eliminate the angle."],
  ["Apollonius's theorem", "Stewart's theorem", "The median case of Stewart's theorem."],
  ["British flag theorem", "Pythagorean theorem", "Four applications of Pythagoras through the perpendiculars from the interior point."],
  ["intersecting chords theorem", "inscribed angle theorem", "Equal inscribed angles make the two triangles at the crossing similar; ratios give the product rule."],
  ["power of a point", "intersecting chords theorem", "The invariant product of chord segments is exactly the point's power with respect to the circle."],
  ["Thales's theorem", "inscribed angle theorem", "A diameter subtends a 180° arc, so the inscribed angle is a right angle."],
  ["Ptolemy's theorem", "inscribed angle theorem", "Equal inscribed angles create the similar triangles of the classical proof."],
  ["law of sines", "inscribed angle theorem", "Each side subtends an inscribed angle; comparing against the circumdiameter gives a/sin A = 2R."],
  ["Ceva's theorem", "Menelaus's theorem", "Apply Menelaus twice to the triangles cut by the cevians and multiply the ratios."],
  ["Pick's theorem", "Euler's polyhedron formula", "Triangulate the lattice polygon into primitive triangles and count faces with Euler's formula."],
  ["Pythagorean trigonometric identity", "Pythagorean theorem", "Divide the Pythagorean relation by the hypotenuse squared."],

  // ---- topology -----------------------------------------------------------
  ["Brouwer fixed-point theorem", "Sperner's lemma", "Sperner's lemma finds the rainbow simplex; a compactness limit turns it into a fixed point."],
  ["Jordan curve theorem", "Brouwer fixed-point theorem", "If the curve failed to separate the plane, one could build a retraction contradicting Brouwer."],
  ["invariance of domain", "Brouwer fixed-point theorem", "Brouwer-style degree arguments force injective continuous images of open sets to be open."],
  ["Borsuk–Ulam theorem", "Tucker's lemma", "Tucker's lemma is the discrete antipodal statement; a limiting argument gives Borsuk–Ulam."],
  ["ham sandwich theorem", "Borsuk–Ulam theorem", "Map each direction to the imbalance of the bisecting cut; Borsuk–Ulam finds the balanced direction."],
  ["hairy ball theorem", "Poincaré–Hopf theorem", "A nonvanishing field would have total index 0, but the sphere's Euler characteristic is 2."],
  ["Poincaré conjecture", "geometrization conjecture", "The elliptic case of Thurston's geometrization, established by Perelman's Ricci flow program."],
  ["Tietze extension theorem", "Urysohn's lemma", "Extend in stages, using Urysohn functions to cut each successive error by a factor."],
  ["Urysohn metrization theorem", "Urysohn's lemma", "Urysohn functions provide the coordinates of an embedding into the Hilbert cube."],
  ["Baire category theorem", "axiom of dependent choice", "The recursive choice of nested balls avoiding each meager set is exactly dependent choice."],

  // ---- combinatorics & graph theory --------------------------------------------
  ["Ramsey's theorem", "pigeonhole principle", "Iterated pigeonhole on neighborhoods drives the induction on colors and clique size."],
  ["Erdős–Szekeres theorem", "pigeonhole principle", "Label points by longest increasing and decreasing runs; pigeonhole forces a long one."],
  ["Dirichlet's approximation theorem", "pigeonhole principle", "Split [0,1) into N boxes; two multiples of α share one, giving a good rational approximation."],
  ["König's theorem (graph theory)", "Hall's marriage theorem", "Hall's condition constructs the matching that meets the minimum vertex cover size."],
  ["Dilworth's theorem", "König's theorem (graph theory)", "Encode the poset as a bipartite graph; König's matching bound becomes the chain cover."],
  ["Menger's theorem", "max-flow min-cut theorem", "With unit capacities, disjoint paths are flows and separators are cuts."],
  ["Szemerédi's theorem", "Szemerédi regularity lemma", "The regularity partition plus a counting lemma locates the arithmetic progressions."],
  ["Van der Waerden's theorem", "Hales–Jewett theorem", "Project combinatorial lines in a large cube onto arithmetic progressions of integers."],
  ["Cayley's formula", "Kirchhoff's theorem", "Evaluate the matrix-tree determinant for the complete graph to get n^(n−2)."],
  ["five color theorem", "Euler's polyhedron formula", "Euler's formula guarantees a vertex of degree at most 5, feeding the induction."],
  ["g-conjecture", "upper bound theorem", "The upper bound theorem constrains the f-vector; the g-conjecture asks for the complete characterization via g-vectors."],

  // ---- logic & computability --------------------------------------------------
  ["Löb's theorem", "diagonal lemma", "The diagonal lemma constructs the sentence 'if I am provable then P' that drives the derivation."],
  ["Kleene's recursion theorem", "diagonal lemma", "The self-referential program is produced by a diagonal construction."],
  ["halting problem", "Cantor's diagonal argument", "Turing diagonalized against any assumed halting decider."],
  ["Rice's theorem", "halting problem", "Any nontrivial semantic property would let you decide halting by a simple reduction."],
  ["Łoś's theorem", "axiom of choice", "The ultrafilters underlying the ultraproduct construction exist by (a consequence of) choice."],

  // ---- probability & statistics --------------------------------------------------
  ["Chebyshev's inequality", "Markov's inequality", "Apply Markov's inequality to the non-negative variable (X − μ)²."],
  ["Chernoff bound", "Markov's inequality", "Apply Markov's inequality to the exponential moment e^(tX) and optimize over t."],
  ["Hoeffding's inequality", "Chernoff bound", "The Chernoff method plus Hoeffding's lemma bounding the moment generating function of bounded variables."],
  ["Azuma's inequality", "Hoeffding's inequality", "Hoeffding's argument applied increment by increment to a bounded-difference martingale."],
  ["law of large numbers", "Chebyshev's inequality", "The variance of the sample mean shrinks like 1/n; Chebyshev converts that into convergence."],
  ["strong law of large numbers", "Borel–Cantelli lemma", "Fourth-moment (or truncation) bounds plus Borel–Cantelli give almost-sure convergence."],
  ["Glivenko–Cantelli theorem", "law of large numbers", "The law of large numbers holds at each quantile; monotonicity makes the convergence uniform."],
  ["Slutsky's theorem", "continuous mapping theorem", "Joint convergence plus the continuous mapping theorem applied to sums and products."],
  ["central limit theorem", "Lévy's continuity theorem", "Characteristic functions converge to the Gaussian's; Lévy's theorem upgrades this to convergence in distribution."],
  ["Donsker's theorem", "central limit theorem", "Finite-dimensional distributions converge by the CLT; a tightness argument completes the invariance principle."],
  ["de Moivre–Laplace theorem", "Stirling's approximation", "Stirling's formula estimates the binomial coefficients directly, revealing the Gaussian profile."],
  ["Kolmogorov extension theorem", "Carathéodory's extension theorem", "The consistent finite-dimensional distributions define a premeasure that Carathéodory extends to the product space."],
  ["law of the iterated logarithm", "Borel–Cantelli lemma", "Both the upper and lower bounds are Borel–Cantelli applied along geometric subsequences."],
  ["optional stopping theorem", "Doob's martingale convergence theorem", "Convergence plus uniform integrability lets expectations pass through the stopping time."],
  ["Wald's equation", "optional stopping theorem", "Apply optional stopping to the centered random walk martingale Sₙ − nμ."],
  ["Bayes' theorem", "law of total probability", "The denominator P(B) expands by the law of total probability over the hypotheses."],

  // ---- second wave: analysis -------------------------------------------------
  ["Cauchy's mean value theorem", "Rolle's theorem", "Rolle's theorem applied to the auxiliary function f(x)·(g(b)−g(a)) − g(x)·(f(b)−f(a))."],
  ["Dini's theorem", "Heine–Borel theorem", "Compactness turns the pointwise monotone convergence into uniform convergence via a finite subcover."],
  ["Riesz–Fischer theorem", "monotone convergence theorem", "Completeness of Lᵖ: monotone convergence sums a rapidly Cauchy subsequence."],
  ["Sobolev embedding theorem", "Hölder's inequality", "The Gagliardo–Nirenberg argument multiplies one-dimensional traces together with Hölder's inequality."],
  ["Rademacher's theorem", "Lebesgue differentiation theorem", "Directional derivatives of a Lipschitz function exist a.e. by differentiating at Lebesgue points."],
  ["Sard's theorem", "Fubini's theorem", "The induction on dimension slices the set of critical values with Fubini's theorem."],
  ["Fourier inversion theorem", "dominated convergence theorem", "Insert a Gaussian mollifier and pass to the limit by dominated convergence."],
  ["Riemann–Lebesgue lemma", "dominated convergence theorem", "Approximate by smooth compactly supported functions; dominated convergence controls the error."],
  ["Hardy–Littlewood maximal inequality", "Vitali covering lemma", "The covering lemma converts the maximal set estimate into a disjoint-ball volume count."],
  ["Lebesgue differentiation theorem", "Hardy–Littlewood maximal inequality", "The weak (1,1) maximal bound shows the set where averages fail to converge has measure zero."],
  ["Rellich–Kondrachov theorem", "Arzelà–Ascoli theorem", "Mollified bounded sequences are equicontinuous, so Arzelà–Ascoli extracts a convergent subsequence."],
  ["Lax equivalence theorem", "uniform boundedness principle", "Stability of the scheme family is precisely a uniform boundedness statement."],

  // ---- second wave: complex analysis -----------------------------------------
  ["Jensen's formula", "Cauchy's integral formula", "Divide out the zeros and integrate log|f| using the mean value property from the integral formula."],
  ["Hadamard factorization theorem", "Jensen's formula", "Jensen's formula bounds the zero-counting function against the growth order of the function."],
  ["Schwarz reflection principle", "Morera's theorem", "Morera's criterion verifies analyticity of the reflected function across the real axis."],
  ["Phragmén–Lindelöf principle", "maximum modulus principle", "Extends the maximum principle to unbounded sectors via auxiliary decaying multipliers."],
  ["Hurwitz's theorem (complex analysis)", "Rouché's theorem", "Rouché's theorem transfers zero counts from the limit function to nearby functions in the sequence."],

  // ---- second wave: algebra & number theory ----------------------------------
  ["Gauss's lemma (number theory)", "Euler's criterion", "The sign count over half-residues is compared against a^((p−1)/2) from Euler's criterion."],
  ["structure theorem for finitely generated modules over a principal ideal domain", "Smith normal form", "Diagonalize a presentation matrix into Smith normal form to read off the invariant factors."],
  ["Jordan normal form", "structure theorem for finitely generated modules over a principal ideal domain", "Apply the structure theorem to the k[x]-module defined by the linear operator."],
  ["rational root theorem", "Gauss's lemma (polynomials)", "A rational root gives a linear factor over ℚ; Gauss's lemma keeps the factorization integral."],
  ["Vieta's formulas", "fundamental theorem of algebra", "Full factorization into linear factors expands into the symmetric functions of the roots."],
  ["Sturm's theorem", "Rolle's theorem", "Rolle-type interlacing of roots governs the sign changes of the Sturm chain."],

  // ---- second wave: geometry & topology --------------------------------------
  ["Gauss–Bonnet theorem", "Green's theorem", "The local formula integrates the connection form over each patch with Green's theorem."],
  ["Whitney embedding theorem", "Sard's theorem", "Sard's theorem shows a generic projection direction keeps the immersion injective."],
  ["Thom transversality theorem", "Sard's theorem", "Transversality fails only on a measure-zero set of parameters, by Sard's theorem."],
  ["fundamental theorem of curves", "Picard–Lindelöf theorem", "Solve the Frenet ODE system; uniqueness of solutions gives the rigidity statement."],
  ["Frobenius theorem (differential topology)", "Picard–Lindelöf theorem", "Integral manifolds are built by flowing along the ODE solutions of the distribution's vector fields."],
  ["Poincaré–Bendixson theorem", "Jordan curve theorem", "A transversal segment together with the Jordan curve theorem traps the planar flow."],
  ["Lefschetz fixed-point theorem", "simplicial approximation theorem", "Approximate the map simplicially, then count fixed simplices via traces on homology."],

  // ---- second wave: combinatorics --------------------------------------------
  ["Sperner's theorem", "Dilworth's theorem", "The Boolean lattice decomposes into symmetric chains; a Dilworth-style bound caps every antichain."],
  ["Birkhoff–von Neumann theorem", "Hall's marriage theorem", "Hall's theorem peels permutation matrices off a doubly stochastic matrix one at a time."],
  ["Pólya enumeration theorem", "Burnside's lemma", "Weight Burnside's fixed-point count by the cycle index of the group action."],

  // ---- second wave: logic & set theory ----------------------------------------
  ["König's theorem (set theory)", "axiom of choice", "Choice picks the witnesses showing the sum of cardinals is strictly below the product."],
  ["compactness theorem", "Łoś's theorem", "An ultraproduct of models of the finite subtheories satisfies the whole theory by Łoś's theorem."],
  ["Craig interpolation theorem", "cut-elimination theorem", "Interpolants are extracted from cut-free proofs by induction on the derivation."],
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
        .where(
          inArray(schema.nodes.type, ["axiom", "theorem", "conjecture", "definition"]),
        )
    ).map((n) => norm(n.title)),
  );

  let seeded = 0;
  let refreshed = 0;
  for (const s of SEED_ENTITIES) {
    const id = `seed:${s.slug}`;
    // Prefer an existing Wikidata/entity leaf with the same title over a seed.
    if (existingTitles.has(norm(s.title))) {
      const alreadySeed = (
        await db
          .select({ id: schema.nodes.id })
          .from(schema.nodes)
          .where(eq(schema.nodes.id, id))
          .limit(1)
      )[0];
      if (!alreadySeed) continue;
    }
    const parentId = resolveMsc(s.msc);
    if (!parentId) {
      console.warn(`  seed ${s.title}: no MSC parent for ${s.msc}, skipped`);
      continue;
    }
    const existing = (
      await db
        .select({ id: schema.nodes.id })
        .from(schema.nodes)
        .where(eq(schema.nodes.id, id))
        .limit(1)
    )[0];
    if (existing) {
      await db
        .update(schema.nodes)
        .set({
          type: s.type,
          title: s.title,
          summary: s.summary,
          wikipediaUrl: s.wiki,
          depth: 4,
          parentId,
        })
        .where(eq(schema.nodes.id, id));
      await db
        .delete(schema.edges)
        .where(
          and(eq(schema.edges.source, id), eq(schema.edges.type, "child-of")),
        );
      await db.insert(schema.edges).values({
        source: id,
        target: parentId,
        type: "child-of",
      });
      refreshed++;
    } else {
      await db.insert(schema.nodes).values({
        id,
        type: s.type,
        title: s.title,
        summary: s.summary,
        wikipediaUrl: s.wiki,
        depth: 4,
        parentId,
      });
      await db.insert(schema.edges).values({
        source: id,
        target: parentId,
        type: "child-of",
      });
      seeded++;
    }
  }
  console.log(`Seeded ${seeded} curated entities (${refreshed} refreshed)`);

  const entityNodes = await db
    .select({ id: schema.nodes.id, title: schema.nodes.title })
    .from(schema.nodes)
    .where(
      inArray(schema.nodes.type, ["axiom", "theorem", "conjecture", "definition"]),
    );
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
  let noted = 0;
  for (const [dependent, prerequisite, note] of DEPENDENCIES) {
    const source = resolve(dependent);
    const target = resolve(prerequisite);
    if (!source) misses.push(dependent);
    if (!target) misses.push(prerequisite);
    if (!source || !target || source === target) continue;
    const key = `${source} ${target}`;
    if (added.has(key)) continue;
    added.add(key);
    if (have.has(key)) {
      // edge exists from a previous run — just backfill/refresh the explanation
      if (note) {
        await db
          .update(schema.edges)
          .set({ note })
          .where(
            and(
              eq(schema.edges.source, source),
              eq(schema.edges.target, target),
              eq(schema.edges.type, "depends-on"),
            ),
          );
        noted++;
      }
      continue;
    }
    rows.push({ source, target, type: "depends-on", note: note ?? null });
  }

  // Remove previously curated edges that are being re-inserted is unnecessary
  // (we skip existing pairs), so this script is safely re-runnable.
  for (const batch of chunk(rows, 500)) {
    await db.insert(schema.edges).values(batch);
  }

  const uniqueMisses = [...new Set(misses)];
  console.log(`Inserted ${rows.length} curated dependency edges, noted ${noted} existing ones`);
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
