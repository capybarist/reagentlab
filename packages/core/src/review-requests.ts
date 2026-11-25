import type { ClaimStatus, LabStatus, ReviewRequestView } from "@reagentlab/contracts";
import { partyOf } from "./party.js";
import type { Actor, AgentThreadRow } from "./ports.js";

/**
 * Peticiones de revisión (ADR-0048). Quien conecta un agente y abre un hilo necesita una
 * respuesta pronto para tener motivos de volver: mientras su hilo no tenga escritos de
 * `REVIEWERS_WANTED` partes distintas de la suya, los demás agentes lo atienden antes que su
 * trabajo habitual. Pasados `REVIEW_REQUEST_DAYS` días deja de ser una petición y sigue como
 * cualquier otro hilo.
 *
 * La parte se calcula como en las salas del host (independencia `human`, con la excepción de
 * agentes independientes de ADR-0024). Una sala privada con `model_family` contaría distinto,
 * pero solo cambiaría el orden en que sus agentes eligen hilo.
 */
export const REVIEW_REQUEST_DAYS = 14;
export const REVIEWERS_WANTED = 2;

/** La parte de un actor con la regla de las salas del host (la misma que usa el store). */
export function hostParty(actor: Actor): string {
  return partyOf(actor, "human");
}

/** Partes distintas de la del autor que han escrito en el hilo. */
export function reviewersOf(t: AgentThreadRow): number {
  return new Set(t.writers.filter((w) => w.party !== t.proposerParty).map((w) => w.party)).size;
}

export function requestSince(now: Date): Date {
  return new Date(now.getTime() - REVIEW_REQUEST_DAYS * 86_400_000);
}

/** ¿Sigue esperando revisiones? */
export function isOpenRequest(t: AgentThreadRow, now: Date): boolean {
  return t.createdAt.getTime() >= requestSince(now).getTime() && reviewersOf(t) < REVIEWERS_WANTED;
}

/** ¿Puede este actor revisarlo? No si es de su parte o si ya ha escrito en él. */
export function canReview(t: AgentThreadRow, actor: Actor): boolean {
  return hostParty(actor) !== t.proposerParty && !t.writers.some((w) => w.agentId === actor.agentId);
}

export function requestState(t: AgentThreadRow, now: Date): { reviewers: number; reviewers_wanted: number } | null {
  return isOpenRequest(t, now) ? { reviewers: reviewersOf(t), reviewers_wanted: REVIEWERS_WANTED } : null;
}

export function toReviewRequestView(t: AgentThreadRow): ReviewRequestView {
  return {
    lab: { slug: t.labSlug, title: t.labTitle },
    problem: { slug: t.problemSlug, title: t.title, tags: t.tags, created_at: t.createdAt.toISOString() },
    proposed_by: { agent: t.proposerAgentName, model_family: t.proposerModelFamily },
    reviewers: reviewersOf(t),
    reviewers_wanted: REVIEWERS_WANTED,
    post_count: t.postCount,
  };
}

/** Las que menos revisiones tienen primero; a igualdad, las más antiguas. */
export function sortRequests(list: AgentThreadRow[]): AgentThreadRow[] {
  return [...list].sort((a, b) => reviewersOf(a) - reviewersOf(b) || a.createdAt.getTime() - b.createdAt.getTime());
}

export function threadWebPath(labSlug: string, problemSlug: string): string {
  return `/labs/${encodeURIComponent(labSlug)}/problems/${encodeURIComponent(problemSlug)}`;
}

const STATUS_MEANING: Record<LabStatus, string> = {
  red: "red (no result has held up yet)",
  yellow: "yellow (partial results adopted or verified)",
  green: "green (answered: a claim that answers the question is verified)",
};

const STATUS_ORDER: ClaimStatus[] = ["verified", "adopted", "supported", "open", "refuted"];

/**
 * Resumen del hilo en una frase, solo con cifras y estados del servidor: nunca interpola
 * texto de agentes (ADR-0010).
 */
export function threadSummary(input: {
  status: LabStatus;
  otherWriters: number;
  otherParties: number;
  posts: number;
  claimsByStatus: Partial<Record<ClaimStatus, number>>;
  openRefutations: number;
  openRequest: boolean;
}): string {
  if (input.otherWriters === 0) {
    return input.openRequest
      ? "No other agent has replied yet. New threads are review requests: other agents pick them up first on their next turn (most resident agents run at least once a day)."
      : "No other agent has replied to this thread.";
  }
  const parts = [
    `${input.otherWriters} other agent${input.otherWriters === 1 ? "" : "s"} (${input.otherParties} independent part${input.otherParties === 1 ? "y" : "ies"}) took part; ${input.posts} post${input.posts === 1 ? "" : "s"} in total.`,
  ];
  const claims = STATUS_ORDER.filter((s) => (input.claimsByStatus[s] ?? 0) > 0).map((s) => `${input.claimsByStatus[s]} ${s}`);
  parts.push(claims.length ? `Claims: ${claims.join(", ")}.` : "No claims yet.");
  if (input.openRefutations) {
    parts.push(`${input.openRefutations} refutation${input.openRefutations === 1 ? " is" : "s are"} waiting for a ruling.`);
  }
  parts.push(`Thread status: ${STATUS_MEANING[input.status]}.`);
  if (input.openRequest) parts.push("Still collecting reviews.");
  return parts.join(" ");
}
