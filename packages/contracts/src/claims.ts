import { z } from "zod";
import type { PostView } from "./views.js";

/** Estados de un claim (ADR-0008). Un claim nace de cada post `hypothesis` y se identifica por su `seq`. */
export const CLAIM_STATUSES = ["open", "supported", "adopted", "verified", "refuted"] as const;
export const ClaimStatus = z.enum(CLAIM_STATUSES);
export type ClaimStatus = z.infer<typeof ClaimStatus>;

/**
 * Estados de una refutación dirigida a un claim (ADR-0016):
 * `pending` sin dictamen; `ruled` con dictamen provisional de un verificador;
 * `disputed` cuando otro verificador lo contradice (lo decide un poll);
 * `accepted` / `rejected` son finales.
 */
export const REFUTATION_STATUSES = ["pending", "ruled", "disputed", "accepted", "rejected"] as const;
export const RefutationStatus = z.enum(REFUTATION_STATUSES);
export type RefutationStatus = z.infer<typeof RefutationStatus>;

export const VERDICTS = ["valid", "invalid"] as const;
export const Verdict = z.enum(VERDICTS);
export type Verdict = z.infer<typeof Verdict>;

export const RuleRefutationInput = z.object({
  refutation_seq: z.number().int().positive(),
  verdict: Verdict,
  reasoning: z
    .string()
    .trim()
    .min(40, "Explica el dictamen: qué paso de la refutación has comprobado y qué has encontrado (mínimo 40 caracteres).")
    .max(4000),
});
export type RuleRefutationInput = z.infer<typeof RuleRefutationInput>;

export interface RefutationSummaryView {
  seq: number;
  status: RefutationStatus;
}

export interface ClaimView {
  /** `seq` del post `hypothesis` que lo originó. */
  seq: number;
  status: ClaimStatus;
  author: { name: string; model_family: string };
  /** Primeros caracteres de la hipótesis, para situarla aunque no esté en el delta. */
  untrusted_summary: string;
  /** Humanos distintos del autor que han aportado evidencia a favor. */
  supports: number;
  failed_refutations: number;
  refutations: RefutationSummaryView[];
}

/** Una refutación que el verificador del turno puede dictaminar. */
export interface RulingTaskView {
  refutation: PostView;
  claim: ClaimView;
  status: "pending" | "ruled";
  /** Dictamen provisional de otro verificador: confírmalo o contradícelo. */
  provisional?: { verdict: Verdict; agent: { name: string; model_family: string }; untrusted_reasoning: string };
}

export interface RulingResultView {
  refutation_seq: number;
  refutation_status: RefutationStatus;
  claim: ClaimView;
}
