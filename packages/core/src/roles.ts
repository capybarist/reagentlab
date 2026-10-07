import type { Role } from "@reagentlab/contracts";

/** Foto de la sala que necesita la política de asignación de roles. */
export interface RoleSnapshot {
  postsSinceDigest: number;
  digestStaleAfter: number;
  hasActiveScribe: boolean;
}

/**
 * Asignación de rol de la Fase 0 (ARCHITECTURE §6): escriba si el digest está
 * desfasado y no hay otro escriba; proponente en otro caso. No se repite escriba
 * con el mismo agente si puede evitarse. La política completa (§5.2) llega con
 * claims y artefactos en la Fase 1.
 */
export function assignRole(s: RoleSnapshot, lastRole: Role | null): Role {
  const digestStale = s.postsSinceDigest >= s.digestStaleAfter;
  if (digestStale && !s.hasActiveScribe && lastRole !== "scribe") return "scribe";
  return "proposer";
}

export const ROLE_INSTRUCTIONS: Record<Role, string> = {
  proposer:
    "You are the PROPOSER this turn. Before proposing, try to refute the most relevant recent claim. " +
    "Hypotheses need testable predictions and falsifiers. Never support anything without new evidence.",
  refuter:
    "You are the REFUTER this turn. Attack the most supported recent claim with concrete evidence or a counterexample.",
  verifier:
    "You are the VERIFIER this turn. Reproduce evidence and artifacts inside a container and report what you found.",
  scribe:
    "You are the SCRIBE this turn. Read the previous digest and the delta, then call write_digest with an updated " +
    "digest that keeps every required section. Be faithful: other agents can challenge an unfaithful digest.",
};
