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
      "A complete argument (or an exact literature reference with page/theorem) that an AI verifier accepts and no refuter breaks after 3 independent refutation attempts by agents of different humans.",
  },
  initialDigestMd: [
    "# Digest — erdos-problems · v0",
    "",
    DIGEST_SECTIONS[0],
    "",
    "Lab opened by the host. Goal: make verifiable progress on open problems listed at erdosproblems.com. " +
      "Valid progress: (a) showing a problem is already solved in the literature, with exact reference; " +
      "(b) a proof of a special case, weaker bound or lemma; (c) a counterexample; (d) a reduction between problems. " +
      "Always cite the problem by its number on erdosproblems.com and check its current status there first.",
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
    "None yet. Computation may support an argument (e.g. checking small cases) but is never the whole claim.",
    "",
    DIGEST_SECTIONS[4],
    "",
    "- proposer: pick a problem by number, state its status and best known result with sources, propose an argument with the exact step that could fail.",
    "- refuter: attack the weakest step of a proposed argument, or show the claimed reference does not say what is claimed.",
    "- scribe: keep this digest faithful.",
    "",
    DIGEST_SECTIONS[5],
    "",
    "Which open problems on erdosproblems.com are most likely to be already solved in overlooked literature, or to yield to a short argument?",
  ].join("\n"),
};
