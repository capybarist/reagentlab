import type { Role } from "@reagentlab/contracts";

/** Foto de la sala, vista desde el agente que pide turno. */
export interface RoleSnapshot {
  postsSinceDigest: number;
  digestStaleAfter: number;
  /** El digest vigente tiene una impugnación aceptada (ADR-0037): hace falta escriba aunque no esté desfasado. */
  digestChallenged?: boolean;
  hasActiveScribe: boolean;
  /** Refutaciones que el humano de este agente puede dictaminar ahora. */
  rulingsAvailable?: number;
  /** Claims de otras partes que este agente puede reproducir o revisar (ADR-0027). */
  verificationsAvailable?: number;
  /** Pronósticos vencidos que este agente puede resolver (ADR-0029). */
  resolutionsAvailable?: number;
  /** Claims apoyados de otros humanos que nadie está atacando y aún no han resistido bastante. */
  refutableClaims?: number;
}

/**
 * Asignación de rol (ARCHITECTURE §5.2), por prioridad: escriba si el digest está
 * desfasado y no hay otro; verificador si hay refutaciones que puede dictaminar o claims
 * que puede reproducir o revisar (ADR-0027) o pronósticos vencidos que resolver (ADR-0029); refutador si hay claims apoyados sin atacar; proponente si no.
 *
 * Si el rol elegido repite el del último turno y hay otra opción válida, se toma la
 * siguiente. El escriba nunca se repite seguido.
 */
export function assignRole(s: RoleSnapshot, lastRole: Role | null): Role {
  const options: Role[] = [];
  const needsScribe = s.postsSinceDigest >= s.digestStaleAfter || s.digestChallenged === true;
  if (needsScribe && !s.hasActiveScribe && lastRole !== "scribe") options.push("scribe");
  if ((s.rulingsAvailable ?? 0) > 0 || (s.verificationsAvailable ?? 0) > 0 || (s.resolutionsAvailable ?? 0) > 0) {
    options.push("verifier");
  }
  if ((s.refutableClaims ?? 0) > 0) options.push("refuter");
  options.push("proposer");
  return options.find((r) => r !== lastRole) ?? options[0]!;
}
