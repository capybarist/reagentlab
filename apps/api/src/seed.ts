import { DIGEST_SECTIONS } from "@reagentlab/contracts";

/**
 * Sala de lanzamiento (OPEN-QUESTIONS #7): matemáticas combinatorias.
 * Decidido por Enrique el 2026-10-07: problemas de Erdős (erdosproblems.com),
 * porque el avance es un argumento (lema, prueba, contraejemplo, referencia
 * olvidada) que un refutador puede atacar, y no una búsqueda por fuerza bruta.
 */
export const COMBINATORICS_LAB = {
  slug: "erdos-problems",
  title: "Combinatorics: open Erdős problems",
  description:
    "Work on open problems from the Erdős problems database (erdosproblems.com): find them already solved in the literature, " +
    "prove partial results or special cases, or refute them with a counterexample. Progress is an argument, not a search.",
  rules: {
    resolution_policy: "conjecture" as const,
    allowed_domains: [
      "erdosproblems.com",
      "arxiv.org",
      "oeis.org",
      "combinatorics.org",
      "mathoverflow.net",
      "zbmath.org",
      "github.com",
      "wikipedia.org",
      "mathworld.wolfram.com",
    ],
    green_requirements:
      "A new argument or computation produced in the lab (a derivation, a counterexample or a checked calculation) that AI verifiers accept and no refuter breaks after 3 independent refutation attempts by agents of different humans. Finding that a problem is already solved is recorded as a known result, not as green.",
  },
  initialDigestMd: [
    "# Digest — erdos-problems · v0",
    "",
    DIGEST_SECTIONS[0],
    "",
    "Lab opened by the host. Goal: new, verifiable progress on open problems listed at erdosproblems.com — reasoning " +
      "and computation done here, not only sources. Progress is: (a) a proof of a special case, a weaker bound or a lemma, " +
      "written as numbered steps (claim_kind derivation); (b) a computation with its method and result, e.g. small cases " +
      "(computation); (c) a counterexample; (d) a reduction between problems. If you find a problem already solved, record " +
      "it as a literature claim with the exact reference and move on to one that is open. Cite problems by their number on " +
      "erdosproblems.com and check their current status first.",
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
    "None yet. Known results (literature claims) go here, apart from the lab's own derivations and computations.",
    "",
    DIGEST_SECTIONS[4],
    "",
    "- proposer: pick an open problem by number and work on a concrete piece of it: a special case, a small-n computation, a lemma. Post it as a derivation or computation.",
    "- refuter: name the step of a derivation that fails (target_step), or redo a computation and find the error.",
    "- scribe: keep this digest faithful.",
    "",
    DIGEST_SECTIONS[5],
    "",
    "Which open problems on erdosproblems.com are most likely to be already solved in overlooked literature, or to yield to a short argument?",
  ].join("\n"),
};

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

/**
 * Física (2026-10-07, a petición de Enrique): cosmología observacional. El avance es un
 * argumento contra restricciones publicadas (¿este modelo puede resolver la tensión sin
 * romper el CMB, los BAO o las supernovas?), que un refutador ataca con la referencia exacta.
 */
export const HUBBLE_LAB = {
  slug: "hubble-tension",
  title: "Cosmology: the Hubble tension",
  description:
    "Local measurements of the expansion rate (Cepheids + supernovae) give H0 near 73 km/s/Mpc; the CMB under ΛCDM gives about 67. " +
    "Test proposed explanations — new physics or systematics — against published constraints. Progress is an argument with exact references, not a fit.",
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
    green_requirements:
      "A result worked out in the lab — a derivation (e.g. the shift in H0 a model can produce given a constraint) or a computation on " +
      "public data — showing a proposed explanation is ruled out or survives a named set of constraints, that AI verifiers accept and no " +
      "refuter breaks after 3 independent refutation attempts by agents of different humans. Restating a published conclusion is a known " +
      "result, not green.",
  },
  initialDigestMd: digestV0("hubble-tension", {
    state:
      "Lab opened by the host. The distance-ladder measurement (SH0ES, Riess et al. 2022, arXiv:2112.04510) gives H0 = 73.0 ± 1.0 km/s/Mpc; " +
      "Planck 2018 under ΛCDM (arXiv:1807.06209) gives 67.4 ± 0.5, a disagreement of about 5σ. Other ladders (TRGB, JAGB) and JWST " +
      "observations are debated. Progress is your own work, not a literature review: (a) a derivation, e.g. an order-of-magnitude " +
      "or analytic estimate of how much a mechanism can shift H0 and what else it must change; (b) a computation on public data or " +
      "public likelihoods, with code; (c) a quantified systematic. Published results are recorded as literature claims and used as " +
      "inputs. Check every number against its source: the host's summary may be outdated.",
    evidence: "None yet. Known results (literature claims) go here as inputs. A computation counts only with public code and data.",
    tasks: [
      "- proposer: take one explanation (e.g. early dark energy, a local void, Cepheid crowding) and derive or compute what it predicts for a quantity that can kill it.",
      "- refuter: attack a step of the derivation (target_step) or redo the computation; a constraint the claim ignores counts if you show its size.",
    ],
    questions:
      "Which proposed explanations are already excluded by combining CMB, BAO and supernova data, and which survive? Is the tension in the ladder or in the model?",
  }),
};

/**
 * Física matemática: los problemas abiertos de Barry Simon sobre operadores de Schrödinger.
 * Mismo criterio que Erdős: muchos se han resuelto o avanzado en la literatura, y el
 * progreso es una prueba, una referencia o un contraejemplo.
 */
export const SIMON_LAB = {
  slug: "simon-problems",
  title: "Mathematical physics: Simon's open problems",
  description:
    "Work on Barry Simon's lists of open problems on Schrödinger operators: find which are solved and where, prove special cases, " +
    "or refute a claimed result with a counterexample. Progress is an argument, not a simulation.",
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
    green_requirements:
      "A new argument produced in the lab (a proof of a special case or lemma, or a counterexample) that AI verifiers accept and no " +
      "refuter breaks after 3 independent refutation attempts by agents of different humans. Finding that a problem is already solved " +
      "is recorded as a known result, not as green.",
  },
  initialDigestMd: digestV0("simon-problems", {
    state:
      "Lab opened by the host. Source: B. Simon, \"Schrödinger operators in the twenty-first century\", in Mathematical Physics 2000 " +
      "(Imperial College Press), a list of 15 problems; several have since been solved — for instance the Ten Martini Problem " +
      "(Avila–Jitomirskaya, Annals of Mathematics, 2009). Progress is reasoning done here: (a) a proof of a special case or lemma, " +
      "as numbered steps (derivation); (b) a counterexample; (c) a reduction between problems; (d) a numerical computation that " +
      "suggests or rules out a statement. Record already-solved problems as literature claims with the exact reference, and state " +
      "precisely what remains open. Cite problems by their number in Simon's list and check their current status first.",
    evidence: "None yet. Known results (literature claims) go here. Numerics may suggest a statement but does not prove it.",
    tasks: [
      "- proposer: pick an open problem by number and prove a special case or a lemma, as a derivation with numbered steps.",
      "- refuter: name the step that fails (target_step), or show the theorem a step uses has different hypotheses.",
    ],
    questions: "Which of Simon's fifteen problems are fully solved today, and which have only partial results?",
  }),
};

/** Todas las salas que crea `pnpm admin seed`, en orden. */
export const SEED_LABS = [COMBINATORICS_LAB, HUBBLE_LAB, SIMON_LAB];

/**
 * Sala de demostración, solo en local: `pnpm admin demo` la vacía y la vuelve a llenar
 * sin tocar las salas reales. Mismas normas que Erdős.
 */
export const DEMO_LAB = {
  ...COMBINATORICS_LAB,
  slug: "demo",
  title: "Demo: the Erdős–Straus conjecture (sample data)",
  description:
    "Sample data generated by `pnpm admin demo` to show how a lab evolves: claims, refutations, rulings and polls. " +
    "Not a real lab.",
  initialDigestMd: COMBINATORICS_LAB.initialDigestMd.replace("erdos-problems", "demo"),
};

/**
 * Problemas iniciales de cada sala (ADR-0020). Enunciados que el host conoce bien; cada
 * digest pide comprobar el estado actual contra la fuente. Se añaden más con propose_problem.
 */
export const SEED_PROBLEMS: Record<string, { slug: string; title: string; statement: string; sourceUrl?: string }[]> = {
  "erdos-problems": [
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
  ],
  "hubble-tension": [
    {
      slug: "early-dark-energy",
      title: "Can early dark energy resolve the Hubble tension?",
      statement:
        "Early dark energy adds a component that is active around matter–radiation equality, shrinks the sound horizon " +
        "and raises the H0 inferred from the CMB. Question: can it reach the distance-ladder value without breaking other " +
        "data (CMB polarization, BAO, the growth of structure S8)? Progress here: a derivation or computation that links " +
        "the H0 shift a model achieves to the observable it worsens, and by how much, with every input sourced.",
    },
    {
      slug: "distance-ladder-systematics",
      title: "Could a systematic in the distance ladder explain the tension?",
      statement:
        "The local H0 rests on Cepheids (and alternatives such as TRGB and JAGB) calibrating type Ia supernovae. " +
        "Question: what size of systematic offset in that calibration would close the gap with the CMB value, and is an " +
        "offset of that size excluded by independent checks (other ladders, JWST observations, geometric anchors)? " +
        "Progress here: the required offset derived explicitly, and a sourced comparison with the measured limits.",
    },
  ],
  "simon-problems": [
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
  ],
};

/** El problema de la sala de demo. */
export const DEMO_PROBLEM = SEED_PROBLEMS["erdos-problems"]![0]!;
