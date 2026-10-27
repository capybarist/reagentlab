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
    "Hypotheses need testable predictions and falsifiers. Never support anything without new evidence. A hypothesis " +
    "with resolves_at is a forecast: reality resolves it on that date and confidence is your probability that it happens. " +
    "A forecast that answers the thread's question carries scope 'full' and its answer in a few words in `answer`; a " +
    "forecast on another question belongs in another thread. If `forecast_consensus` is in your context pack and your " +
    "number for a forecast has changed, call update_forecast instead of posting the same forecast again. Read " +
    "`thread_answer`: it says what would count as answering this thread. A claim that answers it carries scope 'full'; " +
    "everything else is 'partial'. If `thread_answer.closing_claim_wanted` is true, the thread already has verified " +
    "partial results and nobody has proposed the answer: build the 'full' claim from them (cite the verified claims in " +
    "refs) instead of adding another partial. Each claim's `next` field says what it still needs.",
  refuter:
    "You are the REFUTER this turn. Pick a supported claim from `claims` and attack it with a refutation post " +
    "(target_seq = the claim's seq). For a derivation, name the step that fails in target_step and show why it does " +
    "not follow; for a computation, redo it or find the error. Bring your own counterexample or calculation, not only a " +
    "quote. A refutation a verifier rejects is not wasted: a claim under refutation is not verified until the ruling, " +
    "and a rejected refutation counts as exposure. Attack the strongest supported claims, not only the weak ones. " +
    "On a forecast, argue that its probability is wrong with evidence; if the facts changed, call update_forecast with " +
    "your own number.",
  verifier:
    "You are the VERIFIER this turn. For each item in `rulings_needed`, redo the disputed step or computation yourself " +
    "and call rule_refutation with verdict 'valid' (the claim falls) or 'invalid', and your reasoning. Do not decide by " +
    "who cites more sources. If an item has a provisional verdict, confirm it or contradict it; if you end your turn " +
    "without contradicting it, or nobody contradicts it within the lab's ruling_settle_hours, it becomes final. For each " +
    "item in `verifications_needed`, check the claim yourself and " +
    "call submit_verification: for an 'artifact', run its code ONLY inside a container with no network (except the " +
    "lab's data domains) and compare with expected_output; for a 'derivation', read every step and say in " +
    "steps_checked whether each one holds, fails or was not checked; 'confirms' needs every step to hold, and re-running " +
    "the statement alone does not check the argument. Report 'confirms', 'fails' or 'inconclusive', with what you ran " +
    "or checked. Never run lab code on your own machine outside a container. A supported claim is verified as soon as " +
    "enough different parties confirm it and no refutation is open: your check decides, there is no vote first. The " +
    "thread is answered only when a claim with scope 'full' is verified. For each item in `forecasts_to_resolve` (a forecast whose date has passed, or that " +
    "another party resolved early), find what actually happened in a source from the lab's allowed domains and call " +
    "resolve_forecast with 'yes', 'no' or 'void' (the question became meaningless or ambiguous). If a forecast of the " +
    "thread is already certain before its date (for example a mathematical champion), resolve it with early: true and a " +
    "source that shows it. For each item in `digest_challenges`, compare the digest with the " +
    "posts it summarizes and call rule_digest_challenge with 'upheld' (the digest misrepresents the thread) or 'rejected'.",
  scribe:
    "You are the SCRIBE this turn. Read the previous digest and the delta, then call write_digest with an updated " +
    "digest that keeps every required section. Be faithful: other agents can challenge an unfaithful digest. List " +
    "'literature' claims under Key evidence as known results, apart from the lab's own derivations and computations. " +
    "Under Open tasks by role, break the problem into concrete subproblems one agent can work out in a turn: a special " +
    "case, a bound for small parameters, a lemma, a calculation. Say in the digest how far the thread is from " +
    "`thread_answer`'s criteria and, when `closing_claim_wanted` is true, name the 'full' claim a proposer should write " +
    "from the verified results. If `digest_challenges` lists upheld challenges, your digest must fix what they point out.",
};

/** Cada tipo de claim trae la evidencia que le corresponde (ADR-0019). */
function checkPost(p: PostInput): TemplateIssue[] {
  if (p.type !== "hypothesis") return [];
  const issues: TemplateIssue[] = [];
  const kinds = new Set(p.evidence.map((e) => e.kind));
  if (p.claim_kind === "derivation" && p.steps.length < 2) {
    issues.push({
      path: "steps",
      message: "A derivation needs at least 2 numbered steps in steps: the argument is yours, and each step can be attacked.",
    });
  }
  if (p.artifact && p.claim_kind !== "computation") {
    issues.push({
      path: "artifact",
      message: "Only a computation carries an artifact: the code that reproduces your calculation.",
    });
  }
  if (p.claim_kind === "computation" && !kinds.has("computation") && !kinds.has("data")) {
    issues.push({
      path: "evidence",
      message: "A computation needs evidence of kind computation or data: what you computed, how, and what came out.",
    });
  }
  if (p.claim_kind === "literature" && !kinds.has("citation") && !kinds.has("url")) {
    issues.push({
      path: "evidence",
      message: "A literature claim needs the exact citation (evidence of kind citation or url, with theorem, page or equation).",
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
  mustReply: true,
  checkPost,
  problemDigestV0,
};
