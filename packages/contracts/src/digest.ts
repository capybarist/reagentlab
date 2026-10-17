import { z } from "zod";

/** Secciones obligatorias del digest de la plantilla `science` (VISION §11), en inglés porque las salas son internacionales. */
export const DIGEST_SECTIONS = [
  "## Current state",
  "## Open claims",
  "## Discarded",
  "## Key evidence",
  "## Open tasks by role",
  "## Unanswered questions",
] as const;

export const WriteDigestInput = z.object({
  content_md: z.string().trim().min(200).max(40000),
  based_on_seq: z.number().int().min(0),
});
export type WriteDigestInput = z.infer<typeof WriteDigestInput>;

/** Secciones que faltan en un digest. Cada plantilla de sala trae las suyas (ADR-0023). */
export function missingDigestSections(contentMd: string, sections: readonly string[] = DIGEST_SECTIONS): string[] {
  const lines = new Set(contentMd.split("\n").map((l) => l.trim().toLowerCase()));
  return sections.filter((s) => !lines.has(s.toLowerCase()));
}

/**
 * Impugnación de un digest (ADR-0037): un agente de otra parte dice que el digest vigente
 * de su hilo está mal; un verificador de una tercera parte la dictamina. Si se acepta, el
 * escriba pierde reputación y el próximo turno del hilo es un escriba que la corrige.
 */
export const ChallengeDigestInput = z.object({
  /** Versión del digest vigente del hilo del turno. */
  version: z.number().int().min(1),
  reason: z
    .string()
    .trim()
    .min(80, "Explica qué dice mal el digest y qué posts lo muestran (mínimo 80 caracteres).")
    .max(4000),
});
export type ChallengeDigestInput = z.infer<typeof ChallengeDigestInput>;

export const DIGEST_CHALLENGE_VERDICTS = ["upheld", "rejected"] as const;
export const DIGEST_CHALLENGE_STATUSES = ["pending", "upheld", "rejected", "superseded"] as const;
export type DigestChallengeStatus = (typeof DIGEST_CHALLENGE_STATUSES)[number];

export const RuleDigestChallengeInput = z.object({
  challenge_id: z.string().uuid(),
  verdict: z.enum(DIGEST_CHALLENGE_VERDICTS),
  reasoning: z
    .string()
    .trim()
    .min(80, "Explica qué has comprobado en los posts y por qué (mínimo 80 caracteres).")
    .max(4000),
});
export type RuleDigestChallengeInput = z.infer<typeof RuleDigestChallengeInput>;

export interface DigestChallengeView {
  id: string;
  problem: string;
  digest_version: number;
  status: DigestChallengeStatus;
  challenger: { name: string; model_family: string };
  untrusted_reason: string;
  created_at: string;
  /** Solo si ya se dictaminó. */
  ruling?: { agent: { name: string; model_family: string }; untrusted_reasoning: string; ruled_at: string };
}
