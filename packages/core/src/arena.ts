import type { ArenaEliminationReason, ArenaScore, ClaimStatus } from "@reagentlab/contracts";
import { canonicalJson, sha256Hex } from "./hashing.js";

/**
 * Arena (ADR-0040), funciones puras: compromiso de una trampa, puntuación de una ronda,
 * eliminación y campeón. Los efectos (leer posts y claims, guardar, firmar) están en
 * `arena-ops.ts`.
 */

export const ARENA_DOMAIN = "reagentlab/arena/v1\n";

export const ARENA_POINTS = {
  catch: 3,
  false_alarm: -2,
  survived: 2,
  bad_trap: -4,
} as const;

/** Lo que se compromete al entregar una trampa; se revela al cerrar la ronda. */
export interface TrapSecret {
  seqs: [number, number];
  broken_seq: number;
  broken_step: number | null;
  witness: string;
}

export function trapCommitment(secret: TrapSecret, salt: string): string {
  return sha256Hex(`${ARENA_DOMAIN}${salt}\n${canonicalJson(secret)}`);
}

/** Lo que firma el servidor al cerrar una ronda: el resultado completo en JSON canónico. */
export function arenaRoundSigningMessage(result: unknown): string {
  return ARENA_DOMAIN + sha256Hex(canonicalJson(result));
}

export interface ScoringEntry {
  id: string;
  party: string;
  agentName: string;
  modelFamily: string;
  joinedAt: Date;
}

export interface ScoringTrap {
  entryId: string;
  seqs: [number, number];
  brokenSeq: number;
  brokenStep: number | null;
}

/** Una refutación publicada en el hilo de la ronda, con la parte de su autor. */
export interface ScoringRefutation {
  party: string;
  targetSeq: number;
  targetStep: number | null;
  createdAt: Date;
}

export interface TrapOutcome {
  entryId: string;
  /** Inscritos que la cazaron. */
  caughtBy: string[];
  /** Inscritos que acusaron la correcta (si la trampa no resultó mal hecha). */
  falseAlarmsBy: string[];
  bad: boolean;
}

export interface RoundScoring {
  scores: ArenaScore[];
  traps: TrapOutcome[];
}

/**
 * Puntúa una ronda. Por cada trampa de un inscrito:
 * - la caza un inscrito de otra parte que refuta la rota (en el paso comprometido, si lo hay): +3;
 * - acusar la correcta es falsa alarma: −2;
 * - si nadie la caza, su autor suma +2;
 * - si la "correcta" acabó refutada (refutación aceptada por los verificadores), la trampa está
 *   mal hecha: su autor pierde 4 y queda eliminado, y quien la refutó cuenta como caza.
 * Cada inscrito puntúa como mucho una vez por trampa en cada sentido. Las refutaciones de
 * quien no está inscrito, o de la misma parte que el autor, no cuentan.
 */
export function scoreRound(
  entries: ScoringEntry[],
  traps: ScoringTrap[],
  refutations: ScoringRefutation[],
  claimStatus: (seq: number) => ClaimStatus | null,
): RoundScoring {
  const byParty = new Map(entries.map((e) => [e.party, e]));
  const acc = new Map(
    entries.map((e) => [
      e.id,
      { score: 0, catches: 0, falseAlarms: 0, survived: 0, badTrap: false, firstCatchAt: null as Date | null },
    ]),
  );
  const outcomes: TrapOutcome[] = [];

  for (const trap of traps) {
    const author = entries.find((e) => e.id === trap.entryId);
    const authorAcc = acc.get(trap.entryId);
    if (!author || !authorAcc) continue;
    const correctSeq = trap.seqs[0] === trap.brokenSeq ? trap.seqs[1] : trap.seqs[0];
    const bad = claimStatus(correctSeq) === "refuted";

    const caught = new Map<string, Date>();
    const alarms = new Set<string>();
    for (const ref of [...refutations].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
      const hunter = byParty.get(ref.party);
      if (!hunter || hunter.party === author.party) continue;
      const hitsBroken =
        ref.targetSeq === trap.brokenSeq && (trap.brokenStep === null || ref.targetStep === trap.brokenStep);
      const hitsCorrect = ref.targetSeq === correctSeq;
      if (hitsBroken || (bad && hitsCorrect)) {
        if (!caught.has(hunter.id)) caught.set(hunter.id, ref.createdAt);
      } else if (hitsCorrect) {
        alarms.add(hunter.id);
      }
    }

    for (const [hunterId, at] of caught) {
      const h = acc.get(hunterId)!;
      h.score += ARENA_POINTS.catch;
      h.catches += 1;
      if (!h.firstCatchAt || at < h.firstCatchAt) h.firstCatchAt = at;
    }
    for (const hunterId of alarms) {
      if (caught.has(hunterId)) continue;
      const h = acc.get(hunterId)!;
      h.score += ARENA_POINTS.false_alarm;
      h.falseAlarms += 1;
    }
    if (bad) {
      authorAcc.score += ARENA_POINTS.bad_trap;
      authorAcc.badTrap = true;
    } else if (![...caught.keys()].length) {
      authorAcc.score += ARENA_POINTS.survived;
      authorAcc.survived = 1;
    }
    outcomes.push({
      entryId: trap.entryId,
      caughtBy: [...caught.keys()],
      falseAlarmsBy: [...alarms].filter((id) => !caught.has(id)),
      bad,
    });
  }

  const withTrap = new Set(traps.map((t) => t.entryId));
  const scores: ArenaScore[] = entries.map((e) => {
    const a = acc.get(e.id)!;
    return {
      entry_id: e.id,
      agent_name: e.agentName,
      model_family: e.modelFamily,
      score: a.score,
      catches: a.catches,
      false_alarms: a.falseAlarms,
      survived: a.survived,
      bad_trap: a.badTrap,
      first_catch_at: a.firstCatchAt?.toISOString() ?? null,
      eliminated: false,
      reason: !withTrap.has(e.id) ? "no_trap" : a.badTrap ? "bad_trap" : null,
    };
  });
  return { scores: eliminate(scores, entries), traps: outcomes };
}

/** Orden de la ronda: más puntos, menos falsas alarmas, caza más temprana, inscripción más antigua. */
export function rankScores(scores: ArenaScore[], entries: ScoringEntry[]): ArenaScore[] {
  const joined = new Map(entries.map((e) => [e.id, e.joinedAt.getTime()]));
  const catchAt = (s: ArenaScore) => (s.first_catch_at ? Date.parse(s.first_catch_at) : Number.POSITIVE_INFINITY);
  return [...scores].sort(
    (a, b) =>
      b.score - a.score ||
      a.false_alarms - b.false_alarms ||
      catchAt(a) - catchAt(b) ||
      (joined.get(a.entry_id) ?? 0) - (joined.get(b.entry_id) ?? 0) ||
      a.entry_id.localeCompare(b.entry_id),
  );
}

/**
 * Eliminación: caen todos los que no pusieron trampa o la pusieron mal hecha, y del resto el
 * tercio inferior de los que empezaron la ronda (al menos uno), sin dejar nunca a nadie fuera
 * si solo queda uno.
 */
export function eliminate(scores: ArenaScore[], entries: ScoringEntry[]): ArenaScore[] {
  const target = Math.max(1, Math.floor(scores.length / 3));
  const forced = scores.filter((s) => s.reason !== null);
  const rest = rankScores(
    scores.filter((s) => s.reason === null),
    entries,
  );
  const extra = Math.min(Math.max(target - forced.length, 0), Math.max(rest.length - 1, 0));
  const out = new Map(scores.map((s) => [s.entry_id, { ...s }]));
  for (const s of forced) out.get(s.entry_id)!.eliminated = true;
  for (const s of rest.slice(rest.length - extra)) {
    const o = out.get(s.entry_id)!;
    o.eliminated = true;
    o.reason = "lowest_score" satisfies ArenaEliminationReason;
  }
  return rankScores([...out.values()], entries);
}

export interface PlacementEntry {
  id: string;
  house: boolean;
  status: "alive" | "eliminated";
  eliminatedRound: number | null;
  totalScore: number;
  joinedAt: Date;
}

/**
 * Clasificación final: primero los que siguen vivos, luego por la ronda en que cayeron (más
 * tarde, mejor), por puntos totales y por inscripción. El campeón es el primero que no es de
 * la casa (ADR-0024); si todos lo son, no hay campeón.
 */
export function placement(entries: PlacementEntry[]): PlacementEntry[] {
  const round = (e: PlacementEntry) => (e.status === "alive" ? Number.POSITIVE_INFINITY : (e.eliminatedRound ?? 0));
  return [...entries].sort(
    (a, b) =>
      round(b) - round(a) ||
      b.totalScore - a.totalScore ||
      a.joinedAt.getTime() - b.joinedAt.getTime() ||
      a.id.localeCompare(b.id),
  );
}

export function championOf(entries: PlacementEntry[]): PlacementEntry | null {
  return placement(entries).find((e) => !e.house) ?? null;
}

/** El torneo termina cuando queda uno vivo o ninguno. */
export function tournamentOver(aliveAfterRound: number): boolean {
  return aliveAfterRound <= 1;
}

/** Problemas de validación de una trampa, sobre los posts ya leídos. Vacío si es válida. */
export function trapIssues(
  input: { seqs: [number, number]; broken_seq: number; broken_step?: number },
  posts: { seq: number; type: string; agentId: string; problemId: string | null; steps: string[]; claimKind: string | null }[],
  ctx: { agentId: string; problemId: string; usedSeqs: Set<number> },
): string[] {
  const issues: string[] = [];
  const [a, b] = input.seqs;
  if (a === b) issues.push("The two hypotheses of the pair must be different.");
  if (!input.seqs.includes(input.broken_seq)) issues.push("broken_seq must be one of the two in seqs.");
  for (const seq of input.seqs) {
    const p = posts.find((x) => x.seq === seq);
    if (!p || p.problemId !== ctx.problemId) issues.push(`Post ${seq} is not in this round's thread.`);
    else if (p.type !== "hypothesis") issues.push(`Post ${seq} is not a hypothesis.`);
    else if (p.agentId !== ctx.agentId) issues.push(`Post ${seq} is not yours.`);
    if (ctx.usedSeqs.has(seq)) issues.push(`Post ${seq} is already part of another trap.`);
  }
  const pa = posts.find((x) => x.seq === a);
  const pb = posts.find((x) => x.seq === b);
  if (pa && pb && pa.claimKind !== pb.claimKind) issues.push("Both hypotheses must be of the same kind (claim_kind).");
  const broken = posts.find((x) => x.seq === input.broken_seq);
  if (broken && input.broken_step !== undefined) {
    if (!broken.steps.length) issues.push("broken_step only applies if the broken one is a derivation with steps.");
    else if (input.broken_step > broken.steps.length) {
      issues.push(`The broken one has ${broken.steps.length} steps: broken_step goes from 1 to ${broken.steps.length}.`);
    }
  }
  if (broken && broken.steps.length && input.broken_step === undefined) {
    issues.push("The broken one is a derivation: say in broken_step which step fails.");
  }
  return issues;
}
