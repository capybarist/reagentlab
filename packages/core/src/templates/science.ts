import { CLAIM_KINDS, DIGEST_SECTIONS, type PostInput, type Role } from "@reagentlab/contracts";
import type { LabTemplate, TemplateIssue } from "./types.js";

/**
 * Plantilla de investigación científica (ADR-0019, ADR-0023): el avance es trabajo propio
 * (una derivación por pasos, un cálculo, una conjetura) y lo ya publicado es contexto.
 */

const ROLE_INSTRUCTIONS: Record<Role, string> = {
  proposer:
    "You are the PROPOSER this turn. Bring something of your own: a derivation (an argument you worked out, as numbered " +
    "steps), a computation (what you computed, how, and the result) or a new conjecture. Sources support your work; they " +
    "are not the work. A claim of kind 'literature' only records a known result: it is useful context but it is never " +
    "adopted, so do not stop there — build on it. Before proposing, try to refute the most relevant recent claim. " +
    "Hypotheses need testable predictions and falsifiers. Never support anything without new evidence.",
  refuter:
    "You are the REFUTER this turn. Pick a supported claim from `claims` and attack it with a refutation post " +
    "(target_seq = the claim's seq). For a derivation, name the step that fails in target_step and show why it does " +
    "not follow; for a computation, redo it or find the error. Bring your own counterexample or calculation, not only a " +
    "quote. A refutation a verifier rejects still helps: claims must survive refutations before they can be adopted.",
  verifier:
    "You are the VERIFIER this turn. For each item in `rulings_needed`, redo the disputed step or computation yourself " +
    "and call rule_refutation with verdict 'valid' (the claim falls) or 'invalid', and your reasoning. Do not decide by " +
    "who cites more sources. If an item has a provisional verdict, confirm it or contradict it; if you end your turn " +
    "without contradicting it, it becomes final.",
  scribe:
    "You are the SCRIBE this turn. Read the previous digest and the delta, then call write_digest with an updated " +
    "digest that keeps every required section. Be faithful: other agents can challenge an unfaithful digest. List " +
    "'literature' claims under Key evidence as known results, apart from the lab's own derivations and computations. " +
    "Under Open tasks by role, break the problem into concrete subproblems one agent can work out in a turn: a special " +
    "case, a bound for small parameters, a lemma, a calculation.",
};

/** Cada tipo de claim trae la evidencia que le corresponde (ADR-0019). */
function checkPost(p: PostInput): TemplateIssue[] {
  if (p.type !== "hypothesis") return [];
  const issues: TemplateIssue[] = [];
  const kinds = new Set(p.evidence.map((e) => e.kind));
  if (p.claim_kind === "derivation" && p.steps.length < 2) {
    issues.push({
      path: "steps",
      message: "Una derivation necesita al menos 2 pasos numerados en steps: el argumento es tuyo, y cada paso se puede atacar.",
    });
  }
  if (p.claim_kind === "computation" && !kinds.has("computation") && !kinds.has("data")) {
    issues.push({
      path: "evidence",
      message: "Una computation necesita evidencia de tipo computation o data: qué calculaste, cómo y qué salió.",
    });
  }
  if (p.claim_kind === "literature" && !kinds.has("citation") && !kinds.has("url")) {
    issues.push({
      path: "evidence",
      message: "Un claim literature necesita la cita exacta (evidencia de tipo citation o url, con teorema, página o ecuación).",
    });
  }
  return issues;
}

function problemDigestV0(
  lab: { slug: string; title: string },
  problem: { slug: string; title: string; statement: string; sourceUrl: string | null },
): string {
  const body: Record<string, string> = {
    [DIGEST_SECTIONS[0]]:
      `**${problem.title}** — problem opened in the lab "${lab.title}". Statement:\n\n${problem.statement}` +
      (problem.sourceUrl ? `\n\nSource: ${problem.sourceUrl}` : "") +
      "\n\nCheck the current status of the problem against its source before building on it.",
    [DIGEST_SECTIONS[1]]: "None yet.",
    [DIGEST_SECTIONS[2]]: "Nothing discarded yet.",
    [DIGEST_SECTIONS[3]]: "None yet. Known results (literature claims) go here, apart from the lab's own work.",
    [DIGEST_SECTIONS[4]]:
      "- proposer: work on a concrete piece of this problem (a special case, a bound, a lemma, a calculation) and post it as a derivation or computation.\n" +
      "- refuter: name the step that fails (target_step), or redo a computation.\n" +
      "- scribe: keep this digest faithful.",
    [DIGEST_SECTIONS[5]]: "What is the smallest piece of this problem that could be settled in one turn?",
  };
  return [`# Digest — ${lab.slug} / ${problem.slug} · v0`, "", ...DIGEST_SECTIONS.flatMap((s) => [s, "", body[s]!, ""])]
    .join("\n")
    .trimEnd();
}

export const SCIENCE_TEMPLATE: LabTemplate = {
  id: "science",
  digestSections: DIGEST_SECTIONS,
  roleInstructions: ROLE_INSTRUCTIONS,
  claimKinds: CLAIM_KINDS,
  isAdoptable: (kind) => kind !== "literature",
  steppedKinds: ["derivation"],
  checkPost,
  problemDigestV0,
};
