import type { ClaimStatus, RefutationStatus, Verdict } from "@reagentlab/contracts";

/**
 * Máquinas de estado de claims y refutaciones (ADR-0008, ADR-0016). Funciones
 * puras: `LabService` las llama y persiste el resultado; ningún otro sitio
 * cambia el estado de un claim.
 */

export type ClaimEvent =
  | { kind: "support" }
  | { kind: "refutation_accepted" }
  | { kind: "refutation_rejected" }
  | { kind: "poll_adopted" };

export interface ClaimTransition {
  status: ClaimStatus;
  /** Cuánto suma a `failed_refutations`. */
  failedDelta: number;
  /** Un claim verificado no cae con una sola refutación: hace falta además un poll (ADR-0008). */
  needsPoll?: boolean;
}

export function claimTransition(status: ClaimStatus, event: ClaimEvent): ClaimTransition {
  if (status === "refuted") return { status, failedDelta: 0 };
  switch (event.kind) {
    case "support":
      return { status: status === "open" ? "supported" : status, failedDelta: 0 };
    case "refutation_rejected":
      return { status, failedDelta: 1 };
    case "refutation_accepted":
      return status === "verified" ? { status, failedDelta: 0, needsPoll: true } : { status: "refuted", failedDelta: 0 };
    case "poll_adopted":
      return { status: status === "supported" ? "adopted" : status, failedDelta: 0 };
  }
}

/**
 * Lo que la política necesita saber de una refutación para dictaminarla. Las partes son
 * las de `partyOf` (ADR-0023): el humano en la instalación pública.
 */
export interface RefutationState {
  status: RefutationStatus;
  refuterParty: string;
  claimAuthorParty: string;
  provisionalVerdict: Verdict | null;
  provisionalParty: string | null;
}

export type RulingOutcome =
  /** Primer dictamen: queda provisional hasta el siguiente turno de verificador. */
  | { kind: "provisional"; status: "ruled"; verdict: Verdict }
  /** Un segundo verificador coincide: el dictamen es firme. */
  | { kind: "final"; status: "accepted" | "rejected"; verdict: Verdict }
  /** Un segundo verificador discrepa: lo decide un poll. */
  | { kind: "disputed"; status: "disputed" };

export type RulingBlock = "closed" | "conflict_of_interest" | "already_ruled";

/**
 * ¿Puede esta parte dictaminar la refutación? Nunca la del refutador ni la del autor del
 * claim (ADR-0008), ni la que dio el dictamen provisional.
 */
export function rulingBlock(ref: RefutationState, party: string): RulingBlock | null {
  if (ref.status !== "pending" && ref.status !== "ruled") return "closed";
  if (party === ref.refuterParty || party === ref.claimAuthorParty) return "conflict_of_interest";
  if (ref.status === "ruled" && party === ref.provisionalParty) return "already_ruled";
  return null;
}

export function applyRuling(ref: RefutationState, party: string, verdict: Verdict): RulingOutcome {
  const block = rulingBlock(ref, party);
  if (block) throw new Error(`applyRuling: dictamen no permitido (${block})`);
  if (ref.status === "pending") return { kind: "provisional", status: "ruled", verdict };
  if (verdict === ref.provisionalVerdict) return { kind: "final", status: finalStatus(verdict), verdict };
  return { kind: "disputed", status: "disputed" };
}

/** Un dictamen provisional que nadie contradice en un turno de verificador posterior queda firme. */
export function settleBySilence(ref: RefutationState): { status: "accepted" | "rejected"; verdict: Verdict } | null {
  if (ref.status !== "ruled" || !ref.provisionalVerdict) return null;
  return { status: finalStatus(ref.provisionalVerdict), verdict: ref.provisionalVerdict };
}

export function finalStatus(verdict: Verdict): "accepted" | "rejected" {
  return verdict === "valid" ? "accepted" : "rejected";
}

/** Una refutación cuenta como "abierta" mientras nadie la ha resuelto. */
export function isRefutationOpen(status: RefutationStatus): boolean {
  return status === "pending" || status === "ruled" || status === "disputed";
}
