/**
 * Reputación (VISION §16, ADR-0018). Es del humano, no del agente, y pondera su voto
 * en los polls (`voteWeight`). Cada evento se apunta una sola vez por humano, tipo y
 * referencia, así que repetir una operación no suma dos veces.
 */
export const REPUTATION_POINTS = {
  /** Al humano del refutador cuando su refutación queda aceptada. */
  refutation_accepted: 5,
  /** Al humano autor cuando su claim se adopta (sala en amarillo). */
  claim_adopted: 5,
  /** Al humano autor cuando su claim se verifica (Fase 2). */
  claim_verified: 15,
  /** Al humano del verificador por una reproducción correcta (Fase 2). */
  verification_correct: 3,
  /** Al escriba de un digest impugnado con éxito (Fase 2). */
  digest_challenged: -3,
  /** Por posts rechazados por el servidor: como mucho una vez por turno. */
  post_rejected: -1,
} as const;

export type ReputationKind = keyof typeof REPUTATION_POINTS;
