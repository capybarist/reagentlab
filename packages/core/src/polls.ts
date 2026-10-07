import type { ClaimKind, ClaimStatus, LabStatus, PollOutcome, PollResult, Stance } from "@reagentlab/contracts";

/** Políticas puras de los polls (ADR-0011, ADR-0017). */

export interface TallyVote {
  userId: string;
  modelFamily: string;
  stance: Stance;
  weight: number;
}

/**
 * Recuento con tope por familia: si una `model_family` suma más de `familyCap` del
 * peso total, sus votos se escalan hasta ese tope. Con menos de `minFamilies`
 * familias distintas no hay quórum de diversidad. Empate = `no` (no se adopta ni
 * se tumba nada por la mínima).
 */
export function tallyPoll(votes: readonly TallyVote[], opts: { familyCap: number; minFamilies: number }): PollResult {
  const byUser = new Map<string, TallyVote>();
  for (const v of votes) if (!byUser.has(v.userId)) byUser.set(v.userId, v); // un voto por humano
  const unique = [...byUser.values()];

  const total = unique.reduce((s, v) => s + v.weight, 0);
  const familyWeight = new Map<string, number>();
  for (const v of unique) familyWeight.set(v.modelFamily, (familyWeight.get(v.modelFamily) ?? 0) + v.weight);

  const weighted: Record<Stance, number> = { yes: 0, no: 0 };
  for (const v of unique) {
    const fw = familyWeight.get(v.modelFamily)!;
    const scale = fw > 0 ? Math.min(1, (opts.familyCap * total) / fw) : 0;
    weighted[v.stance] += v.weight * scale;
  }
  weighted.yes = round(weighted.yes);
  weighted.no = round(weighted.no);

  const families = familyWeight.size;
  const outcome: PollOutcome =
    families < opts.minFamilies ? "no_quorum" : weighted.yes > weighted.no ? "yes" : "no";
  return { outcome, weighted, voters: unique.length, families };
}

/** Peso de un voto (ADR-0011: entre 0,5 y 1,5). Sin reputación todavía, todos pesan 1. */
export function voteWeight(reputation: number): number {
  return Math.min(1.5, Math.max(0.5, 1 + reputation / 100));
}

export type VoteBlock = "already_voted" | "party_to_the_case";

/** Las partes del caso (autor del claim; en disputas también refutador y verificadores) no votan. */
export function voteBlock(partyUserIds: readonly string[], userId: string, alreadyVoted: boolean): VoteBlock | null {
  if (partyUserIds.includes(userId)) return "party_to_the_case";
  if (alreadyVoted) return "already_voted";
  return null;
}

export interface LastPoll {
  outcome: PollOutcome | null;
  closesAt: Date;
  failedSnapshot: number;
}

/**
 * ¿Toca abrir un poll de adopción para este claim? Tiene que estar apoyado, haber
 * resistido `minFailed` refutaciones y no tener ninguna abierta. Tras un `no` solo
 * se repite si ha resistido más refutaciones; tras `no_quorum`, pasado otro periodo.
 */
export function adoptionDue(
  claim: { status: ClaimStatus; failedRefutations: number; kind?: ClaimKind },
  opts: { minFailed: number; hasOpenRefutation: boolean; hasOpenPoll: boolean; lastPoll: LastPoll | null; pollHours: number; now: Date },
): boolean {
  // Lo ya publicado no se adopta: es un resultado conocido, no un avance de la sala (ADR-0019).
  if (claim.kind === "literature") return false;
  if (claim.status !== "supported" || opts.hasOpenRefutation || opts.hasOpenPoll) return false;
  if (claim.failedRefutations < opts.minFailed) return false;
  return retryAllowed(opts.lastPoll, claim.failedRefutations, opts.pollHours, opts.now);
}

/** ¿Toca abrir un poll para una refutación en disputa? */
export function disputeDue(opts: { hasOpenPoll: boolean; lastPoll: LastPoll | null; pollHours: number; now: Date }): boolean {
  if (opts.hasOpenPoll) return false;
  if (!opts.lastPoll) return true;
  return opts.lastPoll.outcome === "no_quorum" && opts.now >= cooldownEnd(opts.lastPoll, opts.pollHours);
}

function retryAllowed(last: LastPoll | null, failed: number, pollHours: number, now: Date): boolean {
  if (!last) return true;
  if (last.outcome === "no") return failed > last.failedSnapshot;
  if (last.outcome === "no_quorum") return now >= cooldownEnd(last, pollHours);
  return false; // `yes` (ya adoptado) o aún sin cerrar
}

function cooldownEnd(last: LastPoll, pollHours: number): Date {
  return new Date(last.closesAt.getTime() + pollHours * 3_600_000);
}

/** Estado de la sala a partir de sus claims (ARCHITECTURE §5.3). */
export function labStatusFor(counts: Partial<Record<ClaimStatus, number>>): LabStatus {
  if ((counts.verified ?? 0) > 0) return "green";
  if ((counts.adopted ?? 0) > 0) return "yellow";
  return "red";
}

function round(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
