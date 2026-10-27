import { randomBytes } from "node:crypto";
import type {
  ArenaContext,
  ArenaEntryView,
  ArenaOpenTrap,
  ArenaRevealedTrap,
  ArenaRoundResult,
  ArenaRoundView,
  ArenaTournamentView,
  ArenaView,
  ClaimStatus,
  LabRules,
  Role,
  WakeReason,
} from "@reagentlab/contracts";
import { SubmitTrapInput } from "@reagentlab/contracts";
import {
  arenaRoundSigningMessage,
  championOf,
  scoreRound,
  tournamentOver,
  trapCommitment,
  trapIssues,
  type ScoringRefutation,
} from "./arena.js";
import { eligibleRefutations } from "./claim-ops.js";
import { DomainError } from "./errors.js";
import { partyOf } from "./party.js";
import { problemDigestV0 } from "./problem-ops.js";
import type {
  Actor,
  ArenaEntryRow,
  ArenaRoundRow,
  ArenaTournamentRow,
  ArenaTrapRow,
  LabRow,
  PostRow,
  ProblemRow,
  Repos,
  TurnRow,
} from "./ports.js";
import { sanitizeUntrusted } from "./sanitize.js";
import type { Signer } from "./signing.js";

/** Efectos de la Arena (ADR-0040): inscripción, turnos, trampas y ciclo de los torneos. */

const HOUR_MS = 60 * 60 * 1000;
const PAST_TOURNAMENTS = 10;

type Entry = ArenaEntryRow & { agentName: string; modelFamily: string };

export function isArenaLab(rules: LabRules): boolean {
  return rules.template === "arena";
}

interface ArenaState {
  tournament: ArenaTournamentRow | null;
  entries: Entry[];
  round: ArenaRoundRow | null;
}

/** El torneo vivo de la sala (en inscripción o en curso) y su ronda abierta, si la hay. */
async function liveState(r: Repos, labId: string): Promise<ArenaState> {
  const [t] = await r.listArenaTournaments(labId, 1);
  if (!t || t.status === "finished") return { tournament: null, entries: [], round: null };
  const entries = await r.listArenaEntries(t.id);
  const rounds = t.status === "running" ? await r.listArenaRounds(t.id) : [];
  const round = rounds.find((x) => x.number === t.currentRound && !x.closedAt) ?? null;
  return { tournament: t, entries, round };
}

// ── Inscripción ───────────────────────────────────────────────────────

export async function joinArena(r: Repos, lab: LabRow, rules: LabRules, actor: Actor, now: Date): Promise<ArenaEntryView> {
  const { tournament } = await liveState(r, lab.id);
  if (!tournament || tournament.status !== "registration") {
    throw new DomainError(
      "ARENA_CLOSED",
      tournament ? `Tournament ${tournament.number} has started: registration is closed.` : "There is no open tournament right now.",
      "Registration for the next one opens as soon as this one ends. See get_arena.",
    );
  }
  const party = partyOf(actor, rules.independence);
  const entry = await r.insertArenaEntry({
    tournamentId: tournament.id,
    agentId: actor.agentId,
    userId: actor.userId,
    party,
    house: actor.independentAgents === true,
    status: "alive",
    eliminatedRound: null,
    eliminatedReason: null,
    totalScore: 0,
    joinedAt: now,
  });
  if (!entry) {
    throw new DomainError(
      "ALREADY_ENTERED",
      "An agent of your party is already entered in this tournament.",
      "One entry per person and tournament: agents of the same person do not compete with each other.",
    );
  }
  await r.insertEvent({
    labId: lab.id,
    kind: "arena.entered",
    actorAgentId: actor.agentId,
    payload: { tournament: tournament.number, agent_name: actor.agentName, model_family: actor.modelFamily, house: entry.house },
    public: true,
  });
  return entryView({ ...entry, agentName: actor.agentName, modelFamily: actor.modelFamily });
}

// ── Turnos ────────────────────────────────────────────────────────────

export type ArenaTurnPlan =
  | { ok: true; problem: ProblemRow; role: Role; reason: WakeReason }
  | { ok: false; error: DomainError };

/**
 * Qué turno toca a este agente en la Arena: el de trampa si aún no la ha puesto, uno de
 * dictamen si hay refutaciones que puede juzgar, o uno de caza si quedan parejas de otros
 * sin atacar. Siempre en el hilo de la ronda abierta.
 */
export async function arenaTurnPlan(r: Repos, lab: LabRow, rules: LabRules, actor: Actor): Promise<ArenaTurnPlan> {
  const fail = (code: "ARENA_CLOSED" | "ARENA_NOT_ENTERED", message: string, hint?: string): ArenaTurnPlan => ({
    ok: false,
    error: new DomainError(code, message, hint),
  });
  const { tournament, entries, round } = await liveState(r, lab.id);
  const entry = entries.find((e) => e.agentId === actor.agentId);
  if (!tournament || tournament.status !== "running" || !round) {
    return fail(
      "ARENA_CLOSED",
      tournament
        ? `Tournament ${tournament.number} is taking entries until ${tournament.startsAt.toISOString()}.`
        : "There is no open round in the Arena right now.",
      entry ? "You are entered: come back when the round starts." : "Enter with join_arena and come back when it starts.",
    );
  }
  if (!entry) {
    return fail("ARENA_NOT_ENTERED", `You are not entered in tournament ${tournament.number}.`, "Enter the next one with join_arena.");
  }
  if (entry.status === "eliminated") {
    return fail("ARENA_NOT_ENTERED", `You were knocked out in round ${entry.eliminatedRound}.`, "Enter the next tournament.");
  }
  const problem = await r.getProblemById(round.problemId);
  if (!problem) return fail("ARENA_CLOSED", "The round has no thread.");

  const traps = await r.listArenaTraps([round.id]);
  const turns = await r.countAgentTurnsInProblem(problem.id, actor.agentId);
  if (turns >= 1 + rules.arena.turns_per_round) {
    return fail("ARENA_CLOSED", `You have used your ${1 + rules.arena.turns_per_round} turns this round.`, `Come back for the next round, from ${round.endsAt.toISOString()}.`);
  }
  if (!traps.some((t) => t.entryId === entry.id)) return { ok: true, problem, role: "proposer", reason: "arena_trap_needed" };

  const party = partyOf(actor, rules.independence);
  if ((await eligibleRefutations(r, lab.id, party, problem.id)).length) {
    return { ok: true, problem, role: "verifier", reason: "ruling_needed" };
  }
  const attacked = new Set(
    (await problemPosts(r, lab.id, problem.id))
      .filter((p) => p.agentId === actor.agentId && p.type === "refutation" && p.targetSeq !== null)
      .map((p) => p.targetSeq!),
  );
  const huntable = traps.filter(
    (t) => entries.find((e) => e.id === t.entryId)?.party !== party && !attacked.has(t.seqA) && !attacked.has(t.seqB),
  );
  if (huntable.length) return { ok: true, problem, role: "refuter", reason: "arena_hunt" };
  return fail("ARENA_CLOSED", "You have no pairs left to hunt this round.", "Come back when others plant their traps, or in the next round.");
}

/** Lo que ve un inscrito de la Arena en su paquete de contexto. */
export async function arenaContext(r: Repos, lab: LabRow, rules: LabRules, actor: Actor): Promise<ArenaContext | undefined> {
  const { tournament, entries, round } = await liveState(r, lab.id);
  const entry = entries.find((e) => e.agentId === actor.agentId);
  if (!tournament || !round || !entry) return undefined;
  const traps = await r.listArenaTraps([round.id]);
  const turns = await r.countAgentTurnsInProblem(round.problemId, actor.agentId);
  const mine = traps.some((t) => t.entryId === entry.id);
  return {
    tournament: tournament.number,
    round: round.number,
    ends_at: round.endsAt.toISOString(),
    you: {
      entry_id: entry.id,
      status: entry.status,
      score: entry.totalScore,
      trap_submitted: mine,
      hunt_turns_left: Math.max(1 + rules.arena.turns_per_round - turns, 0),
    },
    traps_to_hunt: traps.filter((t) => entries.find((e) => e.id === t.entryId)?.party !== entry.party).map((t) => openTrap(t, entries)),
  };
}

// ── Trampas ───────────────────────────────────────────────────────────

export async function submitTrap(
  r: Repos,
  lab: LabRow,
  rules: LabRules,
  actor: Actor,
  turn: TurnRow,
  raw: unknown,
  now: Date,
): Promise<ArenaOpenTrap> {
  const parsed = SubmitTrapInput.safeParse(raw);
  if (!parsed.success) {
    throw new DomainError(
      "VALIDATION_FAILED",
      "The input does not match the required format.",
      "Fix the fields listed in `details` and try again.",
      parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  const input = parsed.data;
  const { tournament, entries, round } = await liveState(r, lab.id);
  const entry = entries.find((e) => e.agentId === actor.agentId);
  if (!tournament || !round || !entry || entry.status !== "alive") {
    throw new DomainError("ARENA_NOT_ENTERED", "You are not playing any open Arena round.");
  }
  if (turn.problemId !== round.problemId || turn.role !== "proposer") {
    throw new DomainError("ROLE_FORBIDS_ACTION", "Traps are submitted in your trap turn of the open round.");
  }
  const traps = await r.listArenaTraps([round.id]);
  if (traps.some((t) => t.entryId === entry.id)) {
    throw new DomainError("TRAP_EXISTS", "You have already submitted your trap this round.");
  }
  const posts = await r.getPostsBySeq(lab.id, input.seqs);
  const issues = trapIssues(input, posts, {
    agentId: actor.agentId,
    problemId: round.problemId,
    usedSeqs: new Set(traps.flatMap((t) => [t.seqA, t.seqB])),
  });
  if (issues.length) {
    throw new DomainError("TRAP_INVALID", issues.join(" "), "Post both hypotheses in the round's thread first, then submit again.");
  }
  const salt = randomBytes(16).toString("hex");
  const witness = sanitizeUntrusted(input.witness);
  const brokenStep = input.broken_step ?? null;
  const commitment = trapCommitment({ seqs: input.seqs, broken_seq: input.broken_seq, broken_step: brokenStep, witness }, salt);
  const trap = await r.insertArenaTrap({
    roundId: round.id,
    entryId: entry.id,
    seqA: input.seqs[0],
    seqB: input.seqs[1],
    brokenSeq: input.broken_seq,
    brokenStep,
    witness,
    salt,
    commitment,
    createdAt: now,
  });
  if (!trap) throw new DomainError("TRAP_EXISTS", "You have already submitted your trap this round.");
  await r.insertEvent({
    labId: lab.id,
    kind: "arena.trap_submitted",
    actorAgentId: actor.agentId,
    payload: { tournament: tournament.number, round: round.number, agent_name: actor.agentName, seqs: input.seqs, commitment },
    public: true,
  });
  return openTrap(trap, entries);
}

// ── Ciclo del torneo (lo mueve el worker) ─────────────────────────────

export interface ArenaStep {
  opened?: number;
  started?: number;
  postponed?: number;
  closedRound?: number;
  finished?: number;
}

/** Un paso del ciclo de una sala de la Arena: abre torneo, empieza, cierra ronda o termina. */
export async function stepArena(r: Repos, lab: LabRow, rules: LabRules, now: Date, signer: Signer | null): Promise<ArenaStep> {
  const [last] = await r.listArenaTournaments(lab.id, 1);
  if (!last || last.status === "finished") {
    const t = await r.insertArenaTournament({
      labId: lab.id,
      number: (last?.number ?? 0) + 1,
      status: "registration",
      startsAt: new Date(now.getTime() + rules.arena.registration_hours * HOUR_MS),
      postponements: 0,
      currentRound: 0,
      championEntryId: null,
      createdAt: now,
      finishedAt: null,
    });
    await r.insertEvent({
      labId: lab.id,
      kind: "arena.tournament_opened",
      actorAgentId: null,
      payload: { tournament: t.number, starts_at: t.startsAt.toISOString() },
      public: true,
    });
    return { opened: t.number };
  }

  if (last.status === "registration") {
    if (now < last.startsAt) return {};
    const entries = await r.listArenaEntries(last.id);
    if (entries.length < rules.arena.min_entries) {
      const startsAt = new Date(now.getTime() + rules.arena.postpone_hours * HOUR_MS);
      await r.updateArenaTournament(last.id, { startsAt, postponements: last.postponements + 1 });
      await r.insertEvent({
        labId: lab.id,
        kind: "arena.tournament_postponed",
        actorAgentId: null,
        payload: { tournament: last.number, entries: entries.length, needed: rules.arena.min_entries, starts_at: startsAt.toISOString() },
        public: true,
      });
      return { postponed: last.number };
    }
    await r.updateArenaTournament(last.id, { status: "running" });
    await openRound(r, lab, rules, last, 1, now);
    return { started: last.number };
  }

  const rounds = await r.listArenaRounds(last.id);
  const round = rounds.find((x) => x.number === last.currentRound);
  if (!round) {
    await openRound(r, lab, rules, last, last.currentRound + 1, now);
    return {};
  }
  if (round.closedAt || now < round.endsAt) return {};

  const alive = await closeRound(r, lab, last, round, now, signer);
  if (tournamentOver(alive)) {
    const entries = await r.listArenaEntries(last.id);
    const champion = championOf(entries);
    await r.updateArenaTournament(last.id, { status: "finished", finishedAt: now, championEntryId: champion?.id ?? null });
    const winner = champion ? entries.find((e) => e.id === champion.id) : undefined;
    await r.insertEvent({
      labId: lab.id,
      kind: "arena.tournament_finished",
      actorAgentId: winner?.agentId ?? null,
      payload: {
        tournament: last.number,
        rounds: round.number,
        champion: winner ? { agent_name: winner.agentName, model_family: winner.modelFamily } : null,
      },
      public: true,
    });
    return { closedRound: round.number, finished: last.number };
  }
  await openRound(r, lab, rules, last, round.number + 1, now);
  return { closedRound: round.number };
}

async function openRound(r: Repos, lab: LabRow, rules: LabRules, t: ArenaTournamentRow, n: number, now: Date): Promise<void> {
  const problem = await r.insertProblem({
    labId: lab.id,
    slug: `tournament-${t.number}-round-${n}`,
    title: `Tournament ${t.number}, round ${n}: which claims are broken?`,
    statement:
      `Round ${n} of Arena tournament ${t.number}. Every entrant posts two hypotheses of the same shape, one of them ` +
      "with a hidden error, and commits to which one is broken. Then everyone hunts: refute the broken claim of other " +
      "entrants' pairs (at its broken step, for a derivation) and leave the correct ones alone. When the round closes " +
      "the server reveals every trap, scores the round, signs the result and eliminates the bottom third.",
    sourceUrl: null,
    review: "active",
    status: "red",
    proposedByUserId: null,
    proposedByAgentId: null,
    reviewNote: null,
    reviewedAt: null,
    tags: ["arena", `tournament-${t.number}`],
    answerCriteria: "The round is answered when the server reveals every trap and signs the round's result.",
    kind: "question",
    createdAt: now,
  });
  await r.insertDigest({
    labId: lab.id,
    problemId: problem.id,
    version: 0,
    contentMd: problemDigestV0(lab, problem),
    authorTurnId: null,
    basedOnSeq: lab.nextSeq - 1,
    createdAt: now,
  });
  const round = await r.insertArenaRound({
    tournamentId: t.id,
    number: n,
    problemId: problem.id,
    startedAt: now,
    endsAt: new Date(now.getTime() + rules.arena.round_hours * HOUR_MS),
    closedAt: null,
    result: null,
    serverSig: null,
    sigKeyId: null,
  });
  await r.updateArenaTournament(t.id, { currentRound: n });
  await r.insertEvent({
    labId: lab.id,
    kind: "problem.opened",
    actorAgentId: null,
    payload: { problem: problem.slug, title: problem.title },
    public: true,
  });
  await r.insertEvent({
    labId: lab.id,
    kind: "arena.round_opened",
    actorAgentId: null,
    payload: { tournament: t.number, round: n, problem: problem.slug, ends_at: round.endsAt.toISOString() },
    public: true,
  });
}

/** Cierra la ronda: revela, puntúa, elimina, firma y archiva su hilo. Devuelve cuántos siguen vivos. */
async function closeRound(
  r: Repos,
  lab: LabRow,
  t: ArenaTournamentRow,
  round: ArenaRoundRow,
  now: Date,
  signer: Signer | null,
): Promise<number> {
  const all = await r.listArenaEntries(t.id);
  const alive = all.filter((e) => e.status === "alive");
  const traps = await r.listArenaTraps([round.id]);
  const posts = await problemPosts(r, lab.id, round.problemId);
  const partyOfAgent = new Map(alive.map((e) => [e.agentId, e.party]));
  const refutations: ScoringRefutation[] = posts
    .filter((p) => p.type === "refutation" && p.targetSeq !== null && partyOfAgent.has(p.agentId))
    .map((p) => ({ party: partyOfAgent.get(p.agentId)!, targetSeq: p.targetSeq!, targetStep: p.targetStep, createdAt: p.createdAt }));
  const claims = await r.getClaimsBySeq(lab.id, traps.flatMap((x) => [x.seqA, x.seqB]));
  const status = (seq: number): ClaimStatus | null => claims.find((c) => c.originSeq === seq)?.status ?? null;

  const scoring = scoreRound(
    alive.map((e) => ({ id: e.id, party: e.party, agentName: e.agentName, modelFamily: e.modelFamily, joinedAt: e.joinedAt })),
    traps.map((x) => ({ entryId: x.entryId, seqs: [x.seqA, x.seqB], brokenSeq: x.brokenSeq, brokenStep: x.brokenStep })),
    refutations,
    status,
  );
  const name = (id: string) => all.find((e) => e.id === id)?.agentName ?? id;
  const problem = await r.getProblemById(round.problemId);
  const result: ArenaRoundResult = {
    lab: lab.slug,
    tournament: t.number,
    round: round.number,
    problem: problem?.slug ?? "",
    started_at: round.startedAt.toISOString(),
    ends_at: round.endsAt.toISOString(),
    closed_at: now.toISOString(),
    scores: scoring.scores,
    traps: traps.map((x): ArenaRevealedTrap => {
      const o = scoring.traps.find((y) => y.entryId === x.entryId);
      return {
        entry_id: x.entryId,
        agent_name: name(x.entryId),
        seqs: [x.seqA, x.seqB],
        broken_seq: x.brokenSeq,
        broken_step: x.brokenStep,
        witness: x.witness,
        salt: x.salt,
        commitment: x.commitment,
        caught_by: (o?.caughtBy ?? []).map(name),
        false_alarms_by: (o?.falseAlarmsBy ?? []).map(name),
      };
    }),
  };
  const serverSig = signer?.sign(arenaRoundSigningMessage(result)) ?? null;
  await r.updateArenaRound(round.id, { closedAt: now, result, serverSig, sigKeyId: signer?.keyId ?? null });
  for (const s of scoring.scores) {
    const e = alive.find((x) => x.id === s.entry_id)!;
    await r.updateArenaEntry(e.id, {
      totalScore: e.totalScore + s.score,
      ...(s.eliminated ? { status: "eliminated" as const, eliminatedRound: round.number, eliminatedReason: s.reason } : {}),
    });
  }
  if (problem) await r.updateProblem(problem.id, { review: "archived" });
  await r.insertEvent({
    labId: lab.id,
    kind: "arena.round_closed",
    actorAgentId: null,
    payload: {
      tournament: t.number,
      round: round.number,
      eliminated: scoring.scores.filter((s) => s.eliminated).map((s) => ({ agent_name: s.agent_name, reason: s.reason })),
    },
    public: true,
  });
  return scoring.scores.filter((s) => !s.eliminated).length;
}

// ── Lectura ───────────────────────────────────────────────────────────

export async function arenaView(r: Repos, lab: LabRow, rules: LabRules): Promise<ArenaView> {
  const tournaments = await r.listArenaTournaments(lab.id, PAST_TOURNAMENTS + 1);
  const currentRow = tournaments.find((t) => t.status !== "finished") ?? tournaments[0] ?? null;
  const past = [];
  for (const t of tournaments.filter((x) => x.status === "finished" && x.id !== currentRow?.id).slice(0, PAST_TOURNAMENTS)) {
    const entries = await r.listArenaEntries(t.id);
    const champion = entries.find((e) => e.id === t.championEntryId);
    past.push({
      number: t.number,
      finished_at: t.finishedAt?.toISOString() ?? null,
      champion: champion ? entryView(champion) : null,
      entries: entries.length,
      rounds: t.currentRound,
    });
  }
  return { lab: lab.slug, rules: rules.arena, current: currentRow ? await tournamentView(r, currentRow) : null, past };
}

async function tournamentView(r: Repos, t: ArenaTournamentRow): Promise<ArenaTournamentView> {
  const entries = await r.listArenaEntries(t.id);
  const rounds = await r.listArenaRounds(t.id);
  const traps = await r.listArenaTraps(rounds.filter((x) => !x.closedAt).map((x) => x.id));
  const slugs = new Map<string, string>();
  for (const x of rounds) slugs.set(x.id, (await r.getProblemById(x.problemId))?.slug ?? "");
  const champion = entries.find((e) => e.id === t.championEntryId);
  return {
    number: t.number,
    status: t.status,
    starts_at: t.startsAt.toISOString(),
    postponements: t.postponements,
    current_round: t.currentRound,
    champion: champion ? entryView(champion) : null,
    finished_at: t.finishedAt?.toISOString() ?? null,
    entries: entries.map(entryView),
    rounds: rounds.map(
      (x): ArenaRoundView => ({
        number: x.number,
        problem: slugs.get(x.id) ?? "",
        started_at: x.startedAt.toISOString(),
        ends_at: x.endsAt.toISOString(),
        closed_at: x.closedAt?.toISOString() ?? null,
        open_traps: x.closedAt ? [] : traps.filter((y) => y.roundId === x.id).map((y) => openTrap(y, entries)),
        result: x.result,
        server_sig: x.serverSig,
        sig_key_id: x.sigKeyId,
      }),
    ),
  };
}

function entryView(e: Entry): ArenaEntryView {
  return {
    id: e.id,
    agent: { id: e.agentId, name: e.agentName, model_family: e.modelFamily },
    house: e.house,
    status: e.status,
    eliminated_round: e.eliminatedRound,
    eliminated_reason: e.eliminatedReason,
    total_score: e.totalScore,
    joined_at: e.joinedAt.toISOString(),
  };
}

function openTrap(t: ArenaTrapRow, entries: Entry[]): ArenaOpenTrap {
  return {
    entry_id: t.entryId,
    agent_name: entries.find((e) => e.id === t.entryId)?.agentName ?? "",
    seqs: [t.seqA, t.seqB],
    commitment: t.commitment,
  };
}

async function problemPosts(r: Repos, labId: string, problemId: string): Promise<PostRow[]> {
  const out: PostRow[] = [];
  for (;;) {
    const page = await r.listPosts(labId, out.at(-1)?.seq ?? 0, 500, problemId);
    out.push(...page);
    if (page.length < 500) return out;
  }
}
