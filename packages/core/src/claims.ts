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
  | { kind: "poll_adopted" }
  /** Confirmaciones suficientes de su artefacto o de sus pasos (ADR-0027, ADR-0044). */
  | { kind: "verified" };

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
    case "verified":
      // Desde apoyado o adoptado (ADR-0044): la comprobación no espera al poll.
      return { status: status === "adopted" || status === "supported" ? "verified" : status, failedDelta: 0 };
  }
}

/**
 * Estado de un claim vivo según sus apoyos y verificaciones (ADR-0028). Solo decide entre
 * `open` y `supported`: lo adoptado, verificado o refutado lo mueven polls y dictámenes.
 * Un claim apoyado cae a `open` si se queda sin apoyos efectivos o si sus verificaciones
 * fallan más de lo que confirman, y vuelve a `supported` en cuanto deja de ser así.
 */
export function supportStatus(
  status: ClaimStatus,
  effectiveSupports: number,
  verifications: { confirms: number; fails: number },
): ClaimStatus {
  if (status !== "open" && status !== "supported") return status;
  return effectiveSupports > 0 && verifications.fails <= verifications.confirms ? "supported" : "open";
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

/**
 * ¿Ha vencido el plazo de un dictamen provisional (ADR-0045)? Pasadas `settleHours` desde el
 * dictamen sin que nadie lo contradiga, queda firme aunque no haya habido otro verificador.
 */
export function rulingTimedOut(ref: { status: RefutationStatus; ruledAt: Date | null }, settleHours: number, now: Date): boolean {
  if (ref.status !== "ruled" || !ref.ruledAt) return false;
  return now.getTime() >= ref.ruledAt.getTime() + settleHours * 3_600_000;
}

/** Un dictamen provisional que nadie contradice (en un turno de verificador posterior, o en plazo) queda firme. */
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
