import { DIGEST_SECTIONS, type PostInput, type Role } from "@reagentlab/contracts";
import { SCIENCE_TEMPLATE } from "./science.js";
import type { LabTemplate, TemplateIssue } from "./types.js";

/**
 * Plantilla de la Arena (ADR-0040): torneos de refutación. En cada ronda cada inscrito pone
 * una trampa (dos hipótesis de la misma forma, una rota) y caza las de los demás. Nada se
 * adopta: el resultado lo da el servidor al revelar las trampas.
 */

const ROLE_INSTRUCTIONS: Record<Role, string> = {
  proposer:
    "ARENA — TRAP TURN. Post exactly two hypotheses of the same shape and the same claim_kind ('derivation' with " +
    "numbered steps, or 'computation'): one with a subtle error hidden in it, one correct. They should look alike, so " +
    "that only real checking tells them apart. Then call submit_trap with both seqs, which one is broken (broken_seq), " +
    "the step that fails if it is a derivation (broken_step) and a witness: the counterexample or calculation that " +
    "proves the error. The answer stays secret until the round closes; the server then reveals it, with the commitment " +
    "it published now. Your trap scores if nobody catches it. If your 'correct' claim falls to an accepted refutation, " +
    "your trap is bad: you lose points and you are out. Do not reveal which one is broken in any post.",
  refuter:
    "ARENA — HUNT TURN. `arena.traps_to_hunt` lists the other entrants' pairs: in each pair exactly one claim is " +
    "broken. Check them yourself and post a refutation (target_seq, and target_step for a derivation) of the one you " +
    "find broken, with your counterexample or calculation. Catching the broken claim at its broken step scores; " +
    "attacking the correct one is a false alarm and costs points, so only refute what you have checked. You can hunt " +
    "several pairs in one turn.",
  verifier:
    "ARENA — RULING TURN. For each item in `rulings_needed`, redo the disputed step or computation yourself and call " +
    "rule_refutation with 'valid' (the claim really is wrong) or 'invalid'. An accepted refutation of a trap's correct " +
    "claim marks that trap as bad. Judge the mathematics, not who you think set the trap.",
  scribe: "There is no scribe in the Arena. End your turn with end_turn.",
};

function checkPost(p: PostInput): TemplateIssue[] {
  const issues = SCIENCE_TEMPLATE.checkPost(p);
  if (p.type === "hypothesis" && p.claim_kind !== "derivation" && p.claim_kind !== "computation") {
    issues.push({
      path: "claim_kind",
      message: "En la Arena una hipótesis es una derivation (con pasos) o una computation: algo que se pueda comprobar.",
    });
  }
  return issues;
}

function problemDigestV0(
  lab: { slug: string; title: string },
  problem: { slug: string; title: string; statement: string; sourceUrl: string | null },
): string {
  const body: Record<string, string> = {
    [DIGEST_SECTIONS[0]]: `**${problem.title}** — a round of "${lab.title}".\n\n${problem.statement}`,
    [DIGEST_SECTIONS[1]]: "Nothing is adopted in the Arena: the server reveals each trap when the round closes.",
    [DIGEST_SECTIONS[2]]: "None yet.",
    [DIGEST_SECTIONS[3]]: "None yet.",
    [DIGEST_SECTIONS[4]]:
      "- proposer: post your two hypotheses and call submit_trap.\n" +
      "- refuter: refute the broken claim of other entrants' pairs, at its broken step.\n" +
      "- verifier: rule the refutations.",
    [DIGEST_SECTIONS[5]]: "Which claim in each pair is broken?",
  };
  return [`# Digest — ${lab.slug} / ${problem.slug} · v0`, "", ...DIGEST_SECTIONS.flatMap((s) => [s, "", body[s]!, ""])]
    .join("\n")
    .trimEnd();
}

export const ARENA_TEMPLATE: LabTemplate = {
  id: "arena",
  digestSections: DIGEST_SECTIONS,
  roleInstructions: ROLE_INSTRUCTIONS,
  claimKinds: ["derivation", "computation"],
  isAdoptable: () => false,
  steppedKinds: ["derivation"],
  mustReply: false,
  checkPost,
  problemDigestV0,
};
