import type { ClaimStatus, LabRules, VerificationKind, VerificationOutcome } from "@reagentlab/contracts";

/**
 * Verificaciones (ADR-0027), funciones puras. Un claim se verifica reproduciendo su
 * artefacto (cálculos) o revisando sus pasos (derivaciones); un claim adoptado pasa a
 * verde cuando las confirmaciones netas de partes distintas llegan a lo que pide la sala.
 */

/** Qué se verifica de un claim, o null si no hay nada que verificar o la sala no lo usa. */
export function verificationKindOf(
  claim: { kind: string; hasArtifact: boolean },
  rules: Pick<LabRules, "min_reproductions" | "min_derivation_checks">,
): VerificationKind | null {
  if (claim.kind === "computation" && claim.hasArtifact && rules.min_reproductions > 0) return "artifact";
  if (claim.kind === "derivation" && rules.min_derivation_checks > 0) return "derivation";
  return null;
}

export function requiredFor(kind: VerificationKind, rules: Pick<LabRules, "min_reproductions" | "min_derivation_checks">) {
  return kind === "artifact" ? rules.min_reproductions : rules.min_derivation_checks;
}

/** Estados en los que un claim admite verificaciones: vivo y con algo que comprobar. */
const VERIFIABLE_STATUSES: readonly ClaimStatus[] = ["open", "supported", "adopted"];

export type VerificationBlock = "not_verifiable" | "closed" | "conflict_of_interest" | "already_verified";

/**
 * ¿Puede esta parte verificar el claim? Nunca la del autor, y cada parte una sola vez.
 * Un claim ya verde no necesita más; uno refutado ya no se verifica.
 */
export function verificationBlock(
  claim: { status: ClaimStatus; authorParty: string; kind: VerificationKind | null },
  party: string,
  partiesThatVerified: readonly string[],
): VerificationBlock | null {
  if (!claim.kind) return "not_verifiable";
  if (!VERIFIABLE_STATUSES.includes(claim.status)) return "closed";
  if (party === claim.authorParty) return "conflict_of_interest";
  if (partiesThatVerified.includes(party)) return "already_verified";
  return null;
}

export interface Tally {
  confirms: number;
  fails: number;
  inconclusive: number;
}

/** Recuento por parte: cada parte cuenta una vez (la base de datos ya no deja repetir). */
export function tally(verifications: readonly { party: string; outcome: VerificationOutcome }[]): Tally {
  const byParty = new Map<string, VerificationOutcome>();
  for (const v of verifications) if (!byParty.has(v.party)) byParty.set(v.party, v.outcome);
  const t: Tally = { confirms: 0, fails: 0, inconclusive: 0 };
  for (const o of byParty.values()) {
    if (o === "confirms") t.confirms++;
    else if (o === "fails") t.fails++;
    else t.inconclusive++;
  }
  return t;
}

/**
 * ¿Pasa a verde? Solo un claim adoptado (ya superó refutaciones y un poll) y con
 * confirmaciones netas suficientes: un fallo de otra parte resta una confirmación, así que
 * un solo verificador no bloquea para siempre, pero tampoco se ignora.
 */
export function readyForGreen(status: ClaimStatus, t: Tally, required: number): boolean {
  return status === "adopted" && required > 0 && t.confirms - t.fails >= required;
}
