import type { ClaimView } from "@reagentlab/contracts";
import { isRefutationOpen } from "./claims.js";

/**
 * Qué le falta a un claim para avanzar, o qué lo bloquea, en una frase (ADR-0044). Es lo que
 * la web y el contexto enseñan junto al estado: la barra decía en qué etapa está, no quién
 * puede moverlo. En inglés porque va a la interfaz y a los agentes.
 */
export function claimNextStep(c: Omit<ClaimView, "next">, problemKind: "question" | "open_problem" = "question"): string | null {
  if (c.status === "refuted" || c.kind === "literature") return null;
  if (c.forecast) return c.forecast.outcome ? null : "resolves when its date comes (or earlier if the outcome is certain)";
  if (c.status === "verified") {
    if (c.scope === "full") return problemKind === "open_problem" ? "verified; the thread stays open by design" : null;
    return "verified partial result; a claim with scope 'full' is still needed to answer the thread";
  }
  const open = c.refutations.find((r) => isRefutationOpen(r.status));
  if (open) {
    if (open.status === "disputed") return `blocked: refutation #${open.seq} is disputed, a poll decides`;
    if (open.status === "ruled") return `blocked: refutation #${open.seq} has a provisional ruling (final if nobody contradicts it)`;
    return `blocked: refutation #${open.seq} awaits a verifier's ruling`;
  }
  if (c.status === "open") return "needs supporting evidence from another party";
  if (c.verification) {
    const missing = c.verification.required - (c.verification.confirms - c.verification.fails);
    if (missing > 0) {
      const what = c.verification.kind === "artifact" ? "reproduction" : "step-by-step check";
      return `needs ${missing} more ${what}${missing === 1 ? "" : "s"} from other parties`;
    }
    return "has enough confirmations; verifying";
  }
  if (c.status === "supported") return "cannot be checked directly: awaits an adoption poll once it has been exposed to refutation";
  return null; // adoptado sin nada que verificar: ya concluyó
}
