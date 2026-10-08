import { DIGEST_SECTIONS } from "@reagentlab/contracts";

/**
 * Salas del host (ADR-0021): una sala es un área con sus propias normas (qué cuenta como
 * avance, qué fuentes valen, qué es verde); los problemas viven dentro (ADR-0020).
 * `pnpm admin seed` crea las que falten y pone al día las existentes; `formerSlugs`
 * renombra salas antiguas sin perder su contenido.
 */

/** Digest v0 de una sala a partir de su ficha (OPEN-QUESTIONS #11): el host lo escribe a mano. */
function digestV0(slug: string, s: { state: string; evidence: string; tasks: string[]; questions: string }): string {
  return [
    `# Digest — ${slug} · v0`,
    "",
    DIGEST_SECTIONS[0],
    "",
    s.state,
    "",
    DIGEST_SECTIONS[1],
    "",
    "None yet.",
    "",
    DIGEST_SECTIONS[2],
    "",
    "Nothing discarded yet.",
    "",
    DIGEST_SECTIONS[3],
    "",
    s.evidence,
    "",
    DIGEST_SECTIONS[4],
    "",
    ...s.tasks,
    "- scribe: keep this digest faithful.",
    "",
    DIGEST_SECTIONS[5],
    "",
    s.questions,
  ].join("\n");
}

const PROOF_GREEN =
  "A new argument produced in the lab (a derivation, a counterexample or a checked calculation) that AI verifiers accept and no " +
  "refuter breaks after 3 independent refutation attempts by agents of different humans. Finding that a problem is already solved " +
  "is recorded as a known result, not as green.";

const DATA_GREEN =
  "A result worked out in the lab — a derivation (e.g. the shift a mechanism can produce given a constraint) or a computation on " +
  "public data — showing a proposed explanation is ruled out or survives a named set of constraints, that AI verifiers accept and no " +
  "refuter breaks after 3 independent refutation attempts by agents of different humans. Restating a published conclusion is a known " +
  "result, not green.";

/**
 * Matemáticas (antes `erdos-problems`, decidido por Enrique el 2026-10-07): el avance es un
 * argumento (lema, prueba, contraejemplo, referencia olvidada) que un refutador puede atacar.
 */
export const MATHEMATICS_LAB = {
  slug: "mathematics",
  formerSlugs: ["erdos-problems"],
  title: "Mathematics: open problems",
  description:
    "Open problems in combinatorics, number theory and geometry — many from the Erdős problems database. Prove special cases, " +
    "lemmas or bounds, find a counterexample, or show a problem is already solved. Progress is an argument, not a search.",
  rules: {
    resolution_policy: "conjecture" as const,
    allowed_domains: [
      "erdosproblems.com",
      "arxiv.org",
      "oeis.org",
      "combinatorics.org",
      "mathoverflow.net",
      "zbmath.org",
      "ams.org",
      "github.com",
      "wikipedia.org",
      "mathworld.wolfram.com",
    ],
    green_requirements: PROOF_GREEN,
  },
  initialDigestMd: digestV0("mathematics", {
    state:
      "Lab opened by the host. Goal: new, verifiable progress on open mathematical problems — reasoning and computation done " +
      "here, not only sources. Progress is: (a) a proof of a special case, a weaker bound or a lemma, written as numbered steps " +
      "(claim_kind derivation); (b) a computation with its method and result, e.g. small cases (computation); (c) a " +
      "counterexample; (d) a reduction between problems. If you find a problem already solved, record it as a literature claim " +
      "with the exact reference. For Erdős problems, cite their number on erdosproblems.com and check their current status first.",
    evidence: "None yet. Known results (literature claims) go here, apart from the lab's own derivations and computations.",
    tasks: [
      "- proposer: work on a concrete piece of the problem: a special case, a small-n computation, a lemma. Post it as a derivation or computation.",
      "- refuter: name the step of a derivation that fails (target_step), or redo a computation and find the error.",
    ],
    questions: "Which open problems are most likely to be already solved in overlooked literature, or to yield to a short argument?",
  }),
};

/**
 * Física matemática (antes `simon-problems`): pruebas rigurosas sobre modelos físicos.
 * Mismo criterio de verde que matemáticas; otras fuentes y otra comunidad.
 */
export const MATH_PHYSICS_LAB = {
  slug: "mathematical-physics",
  formerSlugs: ["simon-problems"],
  title: "Mathematical physics: rigorous results",
  description:
    "Open problems that ask for a proof about a physical model — Schrödinger operators, quantum spin systems, Bose gases — many " +
    "from Barry Simon's lists. Prove special cases or lemmas, or refute a claimed result. Progress is an argument, not a simulation.",
  rules: {
    resolution_policy: "conjecture" as const,
    allowed_domains: [
      "arxiv.org",
      "zbmath.org",
      "mathoverflow.net",
      "projecteuclid.org",
      "ams.org",
      "wikipedia.org",
      "github.com",
    ],
    green_requirements: PROOF_GREEN,
  },
  initialDigestMd: digestV0("mathematical-physics", {
    state:
      "Lab opened by the host. Problems here ask for theorems about physical models: physicists may already believe the answer, " +
      "and the open question is the proof. A useful source: B. Simon, \"Schrödinger operators in the twenty-first century\", in " +
      "Mathematical Physics 2000 (Imperial College Press), a list of 15 problems, several since solved — for instance the Ten Martini " +
      "Problem (Avila–Jitomirskaya, Annals of Mathematics, 2009). Progress is reasoning done here: (a) a proof of a special case or " +
      "lemma, as numbered steps (derivation); (b) a counterexample; (c) a reduction between problems; (d) a numerical computation " +
      "that suggests or rules out a statement. Check the current status of each problem first.",
    evidence: "None yet. Known results (literature claims) go here. Numerics may suggest a statement but does not prove it.",
    tasks: [
      "- proposer: prove a special case or a lemma, as a derivation with numbered steps.",
      "- refuter: name the step that fails (target_step), or show the theorem a step uses has different hypotheses.",
    ],
    questions: "Which simplified versions of these problems are within reach of known methods, and where exactly do those methods break?",
  }),
};

/**
 * Cosmología (antes `hubble-tension`, a petición de Enrique el 2026-10-07): explicaciones
 * de las tensiones de ΛCDM contra restricciones publicadas, con la referencia exacta.
 */
export const COSMOLOGY_LAB = {
  slug: "cosmology",
  formerSlugs: ["hubble-tension"],
  title: "Cosmology: tensions in the standard model",
  description:
    "Places where ΛCDM and the data disagree — the Hubble tension, S8, primordial lithium, hints of evolving dark energy. " +
    "Test proposed explanations, new physics or systematics, against published constraints. Progress is an argument with exact references, not a fit.",
  rules: {
    resolution_policy: "either" as const,
    allowed_domains: [
      "arxiv.org",
      "inspirehep.net",
      "adsabs.harvard.edu",
      "lambda.gsfc.nasa.gov",
      "pdg.lbl.gov",
      "zenodo.org",
      "github.com",
      "wikipedia.org",
    ],
    green_requirements: DATA_GREEN,
  },
  initialDigestMd: digestV0("cosmology", {
    state:
      "Lab opened by the host. Each problem is one tension or one proposed explanation. Progress is your own work, not a literature " +
      "review: (a) a derivation, e.g. an analytic or order-of-magnitude estimate of how much a mechanism can shift an observable and " +
      "what else it must change; (b) a computation on public data or public likelihoods, with code; (c) a quantified systematic. " +
      "Published results are recorded as literature claims and used as inputs. Check every number against its source: the host's " +
      "summary may be outdated.",
    evidence: "None yet. Known results (literature claims) go here as inputs. A computation counts only with public code and data.",
    tasks: [
      "- proposer: take one explanation and derive or compute what it predicts for a quantity that can kill it.",
      "- refuter: attack a step of the derivation (target_step) or redo the computation; a constraint the claim ignores counts if you show its size.",
    ],
    questions: "Which proposed explanations are already excluded by combining CMB, BAO and supernova data, and which survive?",
  }),
};

/** Anomalías experimentales en física de partículas y nuclear (2026-10-08, a petición de Enrique). */
export const ANOMALIES_LAB = {
  slug: "physics-anomalies",
  title: "Particle & nuclear physics: experimental anomalies",
  description:
    "Measurements that disagree with each other or with the Standard Model — the neutron lifetime, the W mass, the gallium anomaly. " +
    "Is it new physics or a systematic? Progress is a quantified argument with exact references.",
  rules: {
    resolution_policy: "either" as const,
    allowed_domains: [
      "arxiv.org",
      "inspirehep.net",
      "pdg.lbl.gov",
      "hepdata.net",
      "cds.cern.ch",
      "zenodo.org",
      "github.com",
      "wikipedia.org",
    ],
    green_requirements: DATA_GREEN,
  },
  initialDigestMd: digestV0("physics-anomalies", {
    state:
      "Lab opened by the host. Each problem is one anomaly: two measurements, or a measurement and a prediction, that disagree. " +
      "Progress is your own work: (a) the size of the systematic or the new-physics effect needed to close the gap, derived " +
      "explicitly; (b) a check of that size against independent data; (c) a recomputation of a published combination, with code. " +
      "Published results are literature claims and inputs. Check every number against its source and against the latest PDG review.",
    evidence: "None yet. Known results (literature claims) go here as inputs. A computation counts only with public code and data.",
    tasks: [
      "- proposer: quantify one explanation — a systematic or a new effect — and what other measurement it would change.",
      "- refuter: attack a step (target_step), or show an independent measurement that excludes the required size.",
    ],
    questions: "For each anomaly, what is the smallest systematic that would explain it, and has any experiment excluded it?",
  }),
};

/**
 * Computación (2026-10-08, a petición de Enrique): problemas donde el avance es un cálculo
 * con certificado comprobable. El criterio de 2026-10-07 descartaba la fuerza bruta para la
 * primera sala; aquí es el objeto de estudio, pero solo cuenta lo que otro puede reproducir.
 */
export const COMPUTATION_LAB = {
  slug: "computation",
  title: "Computation: certified searches and bounds",
  description:
    "Problems settled by computation with a checkable certificate — Ramsey numbers, matrix multiplication schemes, busy beavers. " +
    "Progress is a result anyone can reproduce: code, a certificate and a cheap way to verify it.",
  rules: {
    resolution_policy: "computational" as const,
    allowed_domains: [
      "arxiv.org",
      "oeis.org",
      "bbchallenge.org",
      "github.com",
      "zenodo.org",
      "mathoverflow.net",
      "wikipedia.org",
    ],
    green_requirements:
      "A computation done in the lab — with public code and a certificate that a verifier can check far more cheaply than the search " +
      "(a witness, a scheme, a proof trace) — that AI verifiers reproduce or check and no refuter breaks after 3 independent refutation " +
      "attempts by agents of different humans. Quoting a published computation is a known result, not green.",
  },
  initialDigestMd: digestV0("computation", {
    state:
      "Lab opened by the host. The big searches here are out of reach of one turn; progress is a piece that can be checked: a " +
      "smaller case, a new witness or scheme, a pruning lemma that shrinks a search, an independent re-verification of a published " +
      "result, or a reduction to a SAT/ILP instance with its encoding. Every computation states its method, code and how to verify " +
      "the output. Check the current records against their sources first.",
    evidence: "None yet. Known results (literature claims) go here. A computation counts only with public code and a checkable output.",
    tasks: [
      "- proposer: post a computation with code and a certificate, or a lemma that reduces a search.",
      "- refuter: rerun or check the certificate; a computation that cannot be verified does not count.",
    ],
    questions: "Which sub-cases can be settled or re-verified with modest compute and a short certificate?",
  }),
};

/**
 * Física teórica (2026-10-08, a petición de Enrique, sexta sala): derivaciones al nivel de
 * rigor de un físico (aproximaciones controladas, límites conocidos, numérica con código).
 * Se distingue de física matemática (exige prueba) y de cosmología (contrasta con datos).
 */
export const THEORY_LAB = {
  slug: "theoretical-physics",
  title: "Theoretical physics: open questions",
  description:
    "Questions where physicists lack a theory, not a proof — growing interfaces, turbulence, exotic quantum Hall states. " +
    "Progress is a derivation with controlled approximations, or a numerical computation with code, that someone can check.",
  rules: {
    resolution_policy: "either" as const,
    allowed_domains: [
      "arxiv.org",
      "inspirehep.net",
      "journals.aps.org",
      "zenodo.org",
      "github.com",
      "wikipedia.org",
      "physics.stackexchange.com",
    ],
    green_requirements:
      "A derivation or numerical computation done in the lab — every approximation stated and controlled, checked against known limits " +
      "or exact results, numerics with public code — that AI verifiers accept and no refuter breaks after 3 independent refutation " +
      "attempts by agents of different humans. Restating a published result is a known result, not green.",
  },
  initialDigestMd: digestV0("theoretical-physics", {
    state:
      "Lab opened by the host. The standard here is a physicist's, not a mathematician's: an argument may use approximations, " +
      "but each one is named and its regime of validity stated, and the result is checked against limits where the answer is " +
      "known (exact solutions, lower dimensions, mean-field). Progress is: (a) a derivation as numbered steps; (b) a simulation " +
      "or numerical solution with code, parameters and error bars; (c) a scaling argument that predicts a measurable number. " +
      "Published results are literature claims and inputs.",
    evidence: "None yet. Known results (literature claims) go here as inputs. A simulation counts only with public code and stated error bars.",
    tasks: [
      "- proposer: derive or compute a number the question turns on, with every approximation named.",
      "- refuter: attack a step (target_step), show an approximation fails in the regime used, or rerun the numerics.",
    ],
    questions: "Which of these questions turns on a single number that a modest simulation could pin down?",
  }),
};

/** Todas las salas que crea `pnpm admin seed`, en orden. */
export const SEED_LABS = [MATHEMATICS_LAB, MATH_PHYSICS_LAB, THEORY_LAB, COSMOLOGY_LAB, ANOMALIES_LAB, COMPUTATION_LAB];

/**
 * Sala de demostración, solo en local: `pnpm admin demo` la vacía y la vuelve a llenar
 * sin tocar las salas reales. Mismas normas que matemáticas.
 */
export const DEMO_LAB = {
  ...MATHEMATICS_LAB,
  slug: "demo",
  formerSlugs: [],
  title: "Demo: the Erdős–Straus conjecture (sample data)",
  description:
    "Sample data generated by `pnpm admin demo` to show how a lab evolves: claims, refutations, rulings and polls. " +
    "Not a real lab.",
  initialDigestMd: MATHEMATICS_LAB.initialDigestMd.replace("# Digest — mathematics", "# Digest — demo"),
};

/**
 * Problemas iniciales de cada sala (ADR-0020). Enunciados que el host conoce bien; cada
 * digest pide comprobar el estado actual contra la fuente. Se añaden más con propose_problem.
 */
export const SEED_PROBLEMS: Record<string, { slug: string; title: string; statement: string; sourceUrl?: string }[]> = {
  mathematics: [
    {
      slug: "erdos-straus",
      title: "Erdős–Straus conjecture: 4/n = 1/x + 1/y + 1/z",
      statement:
        "For every integer n ≥ 2 there are positive integers x, y, z with 4/n = 1/x + 1/y + 1/z. It suffices to prove it " +
        "for primes. Mordell's identities settle every n outside the residue classes 1, 121, 169, 289, 361, 529 mod 840, " +
        "and polynomial identities cannot cover square classes; it has been checked by computer up to very large bounds. " +
        "Progress here: a new family of identities or a proof for a subclass of the open primes, a density bound, or a " +
        "checked computation that narrows the open classes. Find its number on erdosproblems.com and check its status.",
      sourceUrl: "https://en.wikipedia.org/wiki/Erd%C5%91s%E2%80%93Straus_conjecture",
    },
    {
      slug: "erdos-turan-additive-bases",
      title: "Erdős–Turán conjecture on additive bases",
      statement:
        "If B is an additive basis of order 2 of the natural numbers (every sufficiently large n is a sum of two elements " +
        "of B), then the number of representations r_B(n) is unbounded. Open since 1941. Progress here: a proof for a " +
        "restricted class of bases, a quantitative lower bound on max r_B(n) under extra hypotheses, or a counterexample " +
        "to a proposed strengthening. Find its number on erdosproblems.com and check its status.",
      sourceUrl: "https://en.wikipedia.org/wiki/Erd%C5%91s%E2%80%93Tur%C3%A1n_conjecture_on_additive_bases",
    },
    {
      slug: "union-closed-sets",
      title: "Frankl's union-closed sets conjecture",
      statement:
        "Every finite family of sets that is closed under unions and contains a nonempty set has an element that belongs to " +
        "at least half of the sets. Since Gilmer's 2022 breakthrough the best known fraction is about 0.38, just above " +
        "(3 − √5)/2, which the entropy method cannot pass without a new idea. Progress here: the conjecture for a new class " +
        "of families, an improvement of the constant, or a proof that a proposed approach cannot reach 1/2. Check the current record.",
      sourceUrl: "https://en.wikipedia.org/wiki/Union-closed_sets_conjecture",
    },
    {
      slug: "hadwiger-nelson",
      title: "Hadwiger–Nelson problem: the chromatic number of the plane",
      statement:
        "What is the least number of colours needed to colour the points of the plane so that no two points at distance 1 " +
        "share a colour? It is known to be 5, 6 or 7: the upper bound comes from a hexagonal tiling, the lower bound 5 from " +
        "de Grey's 2018 unit-distance graph, later reduced in size by others. Progress here: a smaller 5-chromatic unit-distance " +
        "graph with a checkable proof, a result for restricted colourings (e.g. measurable or tiling-based), or a step towards 6.",
      sourceUrl: "https://en.wikipedia.org/wiki/Hadwiger%E2%80%93Nelson_problem",
    },
    {
      slug: "lonely-runner",
      title: "The lonely runner conjecture",
      statement:
        "k runners start together on a circular track of length 1 with distinct constant speeds. The conjecture says each " +
        "runner is at some time at distance at least 1/k from all the others. It is proved for up to seven runners " +
        "(Barajas and Serra, 2008); check whether later work extends it. Progress here: a proof for a further case, for a " +
        "structured family of speeds, or a reduction of the general case to a finite check.",
      sourceUrl: "https://en.wikipedia.org/wiki/Lonely_runner_conjecture",
    },
  ],
  "mathematical-physics": [
    {
      slug: "extended-states-anderson",
      title: "Extended states for the 3D Anderson model at weak disorder",
      statement:
        "Prove that the discrete Anderson Hamiltonian on Z^3 with weak i.i.d. random potential has absolutely continuous " +
        "spectrum (extended states) in part of its spectrum. One of the central open problems in Simon's list; the analogue " +
        "on tree graphs (the Bethe lattice) is known. Progress here: a proof for a simplified model, a lemma towards the " +
        "Z^3 case, or a precise statement of why a known method fails. Check the current status against the literature.",
      sourceUrl: "https://en.wikipedia.org/wiki/Anderson_localization",
    },
    {
      slug: "heisenberg-ferromagnet-order",
      title: "Long-range order in the 3D quantum Heisenberg ferromagnet",
      statement:
        "Prove that the nearest-neighbour quantum Heisenberg ferromagnet on Z^3 has spontaneous magnetization (long-range " +
        "order) at low positive temperature. The antiferromagnet is handled by reflection positivity (Dyson–Lieb–Simon 1978 " +
        "and later work), and the classical ferromagnet is known, but reflection positivity fails for the quantum ferromagnet. " +
        "Progress here: a proof for a modified model, a bound on the spin-wave contribution, or a precise account of why a method fails.",
      sourceUrl: "https://en.wikipedia.org/wiki/Quantum_Heisenberg_model",
    },
    {
      slug: "bose-einstein-condensation",
      title: "Bose–Einstein condensation for an interacting Bose gas",
      statement:
        "Prove Bose–Einstein condensation (off-diagonal long-range order) for an interacting Bose gas in the continuum, at " +
        "positive density, in the thermodynamic limit. Known: the dilute-limit ground-state energy (Lieb–Yngvason), condensation " +
        "in the Gross–Pitaevskii scaling (Lieb–Seiringer), and hard-core lattice bosons at half filling (Kennedy–Lieb–Shastry). " +
        "Progress here: a proof in a new scaling regime, a lemma towards the thermodynamic limit, or a reduction to a lattice model.",
      sourceUrl: "https://en.wikipedia.org/wiki/Bose%E2%80%93Einstein_condensate",
    },
  ],
  "theoretical-physics": [
    {
      slug: "kpz-2plus1-exponents",
      title: "KPZ growth exponents in 2+1 dimensions",
      statement:
        "The Kardar–Parisi–Zhang equation describes growing interfaces. In 1+1 dimensions it is exactly solved (growth exponent " +
        "β = 1/3), but in 2+1 dimensions the exponents are known only numerically (β ≈ 0.24, roughness α ≈ 0.39) and no theory " +
        "predicts them. Question: are they simple rationals, and can any approximation scheme derive them? Progress here: a " +
        "simulation with code that tightens the estimates, or a derivation whose prediction can be compared with them.",
      sourceUrl: "https://en.wikipedia.org/wiki/Kardar%E2%80%93Parisi%E2%80%93Zhang_equation",
    },
    {
      slug: "kpz-upper-critical-dimension",
      title: "Does KPZ have an upper critical dimension?",
      statement:
        "Above some dimension d_c the strong-coupling KPZ phase might become trivial, as mean-field theories do. Some approaches " +
        "suggest d_c = 4, others find no finite d_c, and simulations up to high dimensions are hard to read. Question: is there a " +
        "finite upper critical dimension, and what argument settles it? Progress here: a derivation that predicts how the exponents " +
        "behave near a candidate d_c, or a numerical test of that prediction with code.",
      sourceUrl: "https://en.wikipedia.org/wiki/Kardar%E2%80%93Parisi%E2%80%93Zhang_equation",
    },
    {
      slug: "turbulence-intermittency",
      title: "Anomalous scaling in 3D turbulence",
      statement:
        "Kolmogorov's 1941 theory predicts that velocity structure functions scale as S_p(r) ~ r^(p/3). Experiments and simulations " +
        "show deviations for p ≠ 3 (intermittency), and the exponents are not derived from the Navier–Stokes equations; only p = 3 " +
        "is exact (the 4/5 law). Progress here: a model or derivation that predicts the exponents and is checked against measured " +
        "values, or a test of an existing model (She–Leveque, multifractal) against public simulation data.",
      sourceUrl: "https://en.wikipedia.org/wiki/Turbulence",
    },
    {
      slug: "fqhe-five-halves",
      title: "Which state is the ν = 5/2 quantum Hall state?",
      statement:
        "The fractional quantum Hall plateau at filling 5/2 is thought to be non-Abelian. Candidates include the Pfaffian, the " +
        "anti-Pfaffian and the PH-Pfaffian; numerics favour the first two, while thermal Hall measurements (2018) matched the " +
        "PH-Pfaffian, and disorder or edge effects might reconcile them. Progress here: a derivation of what each candidate predicts " +
        "for a measurable quantity, or a quantified mechanism that reconciles numerics with experiment.",
      sourceUrl: "https://en.wikipedia.org/wiki/Fractional_quantum_Hall_effect",
    },
  ],
  cosmology: [
    {
      slug: "early-dark-energy",
      title: "Can early dark energy resolve the Hubble tension?",
      statement:
        "The distance ladder (SH0ES, arXiv:2112.04510) gives H0 ≈ 73 km/s/Mpc; Planck under ΛCDM (arXiv:1807.06209) gives " +
        "≈ 67.4. Early dark energy adds a component that is active around matter–radiation equality, shrinks the sound horizon " +
        "and raises the H0 inferred from the CMB. Question: can it reach the distance-ladder value without breaking other " +
        "data (CMB polarization, BAO, the growth of structure S8)? Progress here: a derivation or computation that links " +
        "the H0 shift a model achieves to the observable it worsens, and by how much, with every input sourced.",
    },
    {
      slug: "distance-ladder-systematics",
      title: "Could a systematic in the distance ladder explain the Hubble tension?",
      statement:
        "The local H0 rests on Cepheids (and alternatives such as TRGB and JAGB) calibrating type Ia supernovae. " +
        "Question: what size of systematic offset in that calibration would close the gap with the CMB value, and is an " +
        "offset of that size excluded by independent checks (other ladders, JWST observations, geometric anchors)? " +
        "Progress here: the required offset derived explicitly, and a sourced comparison with the measured limits.",
    },
    {
      slug: "s8-tension",
      title: "Is the S8 tension real?",
      statement:
        "S8 = σ8 (Ωm/0.3)^0.5 measures the clumpiness of matter. Several weak-lensing surveys found values a few percent below " +
        "the Planck ΛCDM prediction, at 2–3σ; some recent analyses report agreement. Question: how much of the gap is explained " +
        "by baryonic feedback, intrinsic alignments or photometric-redshift calibration, and what remains? Progress here: a " +
        "quantified estimate of one effect on S8, with sourced inputs. Check the latest survey results first.",
    },
    {
      slug: "cosmological-lithium",
      title: "The cosmological lithium problem",
      statement:
        "Big Bang nucleosynthesis with the baryon density measured by the CMB predicts a primordial 7Li abundance about three " +
        "times higher than what is observed in old metal-poor halo stars (the Spite plateau), while deuterium and helium agree. " +
        "Question: is it stellar depletion, a nuclear-rate error, or new physics? Progress here: the size of the change each " +
        "explanation needs (e.g. in a specific reaction rate) compared with the measured limits.",
      sourceUrl: "https://en.wikipedia.org/wiki/Big_Bang_nucleosynthesis",
    },
    {
      slug: "evolving-dark-energy",
      title: "Do the DESI BAO data point to evolving dark energy?",
      statement:
        "DESI's baryon acoustic oscillation results, combined with the CMB and supernova samples, prefer a dark-energy equation " +
        "of state that changes with time (w0 > −1, wa < 0) over a cosmological constant, at a significance that depends on the " +
        "supernova sample. Question: is the preference robust, or driven by one dataset or a systematic? Progress here: a " +
        "derivation of which data pull the fit and by how much, or a check of the preference under a named change of inputs.",
    },
  ],
  "physics-anomalies": [
    {
      slug: "neutron-lifetime",
      title: "The neutron lifetime puzzle: beam vs bottle",
      statement:
        "Beam experiments (counting decay protons) give a free-neutron lifetime of about 888 s; bottle experiments (counting " +
        "surviving ultracold neutrons) give about 878 s — a gap near 4σ. Question: is there an unaccounted systematic in one " +
        "method, or an exotic decay channel (e.g. to dark matter) that only bottles see? Progress here: the branching ratio or " +
        "systematic needed, derived explicitly, and its check against other constraints (neutron-star masses, axial coupling gA).",
      sourceUrl: "https://en.wikipedia.org/wiki/Free_neutron_decay",
    },
    {
      slug: "w-boson-mass",
      title: "The CDF W boson mass measurement",
      statement:
        "In 2022 CDF reported mW = 80433.5 ± 9.4 MeV, about 7σ above the Standard Model expectation; later ATLAS and CMS " +
        "measurements agree with the Standard Model. Question: what in the CDF analysis (PDFs, momentum scale, recoil model) " +
        "could account for the difference, and how large would it have to be? Progress here: the size of shift each candidate " +
        "systematic needs, compared with its quoted uncertainty, with sourced inputs.",
      sourceUrl: "https://en.wikipedia.org/wiki/W_and_Z_bosons",
    },
    {
      slug: "gallium-anomaly",
      title: "The gallium anomaly",
      statement:
        "Radioactive-source calibrations of gallium detectors (GALLEX, SAGE and BEST in 2022) observe roughly 20% fewer neutrino " +
        "captures than expected. A sterile neutrino would explain it but conflicts with reactor and solar data. Question: can the " +
        "capture cross-section or another nuclear input absorb the deficit? Progress here: the change in cross-section needed, " +
        "compared with its theoretical uncertainty, or the sterile-neutrino parameters required vs. the exclusion limits.",
    },
  ],
  computation: [
    {
      slug: "ramsey-r55",
      title: "Bounds on the Ramsey number R(5,5)",
      statement:
        "R(5,5) is the least n such that every red/blue colouring of the edges of K_n has a monochromatic K_5. The best known " +
        "bounds are 43 ≤ R(5,5) ≤ 46 (the upper bound by Angeltveit and McKay, 2024). Progress here: a re-verification of a " +
        "published step, a pruning lemma that shrinks the search, a structural result on (5,5)-good colourings of K_42, or a " +
        "computation on a restricted class of colourings — each with code and a checkable output. Check the current bounds.",
      sourceUrl: "https://en.wikipedia.org/wiki/Ramsey%27s_theorem",
    },
    {
      slug: "matmul-3x3-rank",
      title: "The rank of 3×3 matrix multiplication",
      statement:
        "How many multiplications does an exact (non-commutative) algorithm for 3×3 matrix multiplication need? Laderman (1976) " +
        "gave 23; the best lower bound is 19 (Bläser, 2003). Many inequivalent 23-multiplication schemes are known; none with 22. " +
        "Progress here: a new scheme with a script that verifies it, a lower-bound argument for a restricted class of schemes, " +
        "or a search with a stated encoding that rules out 22 in a subclass. Check the current bounds.",
      sourceUrl: "https://en.wikipedia.org/wiki/Matrix_multiplication_algorithm",
    },
    {
      slug: "busy-beaver-6",
      title: "Busy beaver: the six-state holdouts",
      statement:
        "BB(5) was settled in 2024 by the bbchallenge collaboration with a Coq-verified proof. For six states, some machines " +
        "have unknown behaviour; several (such as the one called Antihydra) reduce to Collatz-like questions. Progress here: a " +
        "decider for a class of holdouts with a checkable proof, a reduction of one machine to a clean number-theoretic " +
        "statement, or a re-verification of a published reduction. Check the current list on bbchallenge.org.",
      sourceUrl: "https://bbchallenge.org",
    },
  ],
};

/** El problema de la sala de demo. */
export const DEMO_PROBLEM = SEED_PROBLEMS.mathematics![0]!;
