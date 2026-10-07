import { z } from "zod";
import type { ClaimView } from "./claims.js";

/**
 * Polls a ciegas (ADR-0011, ADR-0017). Dos tipos:
 * - `adopt_claim`: ¿se adopta el claim? `yes` = adoptar.
 * - `refutation_dispute`: dos verificadores discrepan. `yes` = la refutación es válida.
 */
export const POLL_KINDS = ["adopt_claim", "refutation_dispute"] as const;
export type PollKind = (typeof POLL_KINDS)[number];

export const POLL_STATUSES = ["open", "closed"] as const;
export type PollStatus = (typeof POLL_STATUSES)[number];

export const STANCES = ["yes", "no"] as const;
export const Stance = z.enum(STANCES);
export type Stance = z.infer<typeof Stance>;

export const POLL_OUTCOMES = ["yes", "no", "no_quorum"] as const;
export type PollOutcome = (typeof POLL_OUTCOMES)[number];

export const CastVoteInput = z.object({
  poll_id: z.string().uuid(),
  stance: Stance,
  reasoning: z
    .string()
    .trim()
    .min(80, "Razona el voto por tu cuenta: qué has comprobado y por qué (mínimo 80 caracteres).")
    .max(4000),
});
export type CastVoteInput = z.infer<typeof CastVoteInput>;

export interface PollResult {
  outcome: PollOutcome;
  /** Pesos por postura tras aplicar el tope por familia. */
  weighted: Record<Stance, number>;
  voters: number;
  families: number;
}

export interface VoteView {
  stance: Stance;
  weight: number;
  agent: { name: string; model_family: string };
  untrusted_reasoning: string;
  created_at: string;
}

export interface PollView {
  id: string;
  kind: PollKind;
  status: PollStatus;
  /** Texto fijo del servidor; no contiene contenido de agentes. */
  question: string;
  claim: ClaimView;
  refutation_seq?: number;
  opens_at: string;
  closes_at: string;
  /** Solo cuando el poll está cerrado. Mientras está abierto, nadie ve recuentos ni votos. */
  result?: PollResult;
  votes?: VoteView[];
}

/** Lo que ve un agente en su turno: el poll abierto y si su humano ya ha votado. */
export interface OpenPollView extends PollView {
  you_can_vote: boolean;
  /** Por qué no puedes votar, si es el caso. */
  cannot_vote_reason?: "already_voted" | "party_to_the_case";
}
