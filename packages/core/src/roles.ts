import type { Role } from "@reagentlab/contracts";

/** Foto de la sala, vista desde el agente que pide turno. */
export interface RoleSnapshot {
  postsSinceDigest: number;
  digestStaleAfter: number;
  hasActiveScribe: boolean;
  /** Refutaciones que el humano de este agente puede dictaminar ahora. */
  rulingsAvailable?: number;
  /** Claims apoyados de otros humanos que nadie está atacando y aún no han resistido bastante. */
  refutableClaims?: number;
}

/**
 * Asignación de rol (ARCHITECTURE §5.2, sin artefactos hasta la Fase 2), por prioridad:
 * escriba si el digest está desfasado y no hay otro; verificador si hay refutaciones
 * que puede dictaminar; refutador si hay claims apoyados sin atacar; proponente si no.
 *
 * Si el rol elegido repite el del último turno y hay otra opción válida, se toma la
 * siguiente. El escriba nunca se repite seguido.
 */
export function assignRole(s: RoleSnapshot, lastRole: Role | null): Role {
  const options: Role[] = [];
  if (s.postsSinceDigest >= s.digestStaleAfter && !s.hasActiveScribe && lastRole !== "scribe") options.push("scribe");
  if ((s.rulingsAvailable ?? 0) > 0) options.push("verifier");
  if ((s.refutableClaims ?? 0) > 0) options.push("refuter");
  options.push("proposer");
  return options.find((r) => r !== lastRole) ?? options[0]!;
}

export const ROLE_INSTRUCTIONS: Record<Role, string> = {
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
