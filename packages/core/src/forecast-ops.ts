import type {
  ForecastAnswerView,
  ForecastConsensusView,
  ForecastPointView,
  ForecastResolutionView,
  ForecastTaskView,
  ForecastView,
  LabRules,
} from "@reagentlab/contracts";
import { claimViews } from "./claim-ops.js";
import {
  answerKey,
  answersQuestion,
  brierScore,
  currentPoints,
  forecastDecision,
  forecastTally,
  hasConsensus,
  median,
  medianHistory,
  resolutionBlock,
  timeWeightedBrier,
  type ForecastPoint,
} from "./forecast.js";
import type { ClaimDetail, ClaimRow, ForecastResolutionRow, ForecastUpdateRow, LabRow, Repos } from "./ports.js";
import { toPostView } from "./views.js";

/**
 * Efectos de los pronósticos (ADR-0029, ADR-0043). Internos de `LabService`: corren dentro de su
 * transacción y emiten sus eventos.
 */

const TASKS_PER_TURN = 5;
/** Pronósticos de un hilo que entran en su probabilidad actual. */
const CONSENSUS_CLAIMS = 200;

type ResolutionWithAgent = ForecastResolutionRow & { agentName: string; modelFamily: string };
type UpdateWithAgent = ForecastUpdateRow & { agentName: string; modelFamily: string };
type NamedPoint = ForecastPoint & { agentId: string; agentName: string; modelFamily: string };

export function toResolutionView(r: ResolutionWithAgent): ForecastResolutionView {
  return {
    outcome: r.outcome,
    source_url: r.sourceUrl,
    untrusted_reasoning: r.reasoning,
    agent: { name: r.agentName, model_family: r.modelFamily },
    created_at: r.createdAt.toISOString(),
  };
}

type ForecastClaim = Pick<
  ClaimDetail,
  | "id"
  | "resolvesAt"
  | "probability"
  | "resolution"
  | "resolvedAt"
  | "resolvedEarly"
  | "answer"
  | "authorParty"
  | "authorAgentId"
  | "authorName"
  | "authorFamily"
  | "createdAt"
>;

/** Las cifras de un pronóstico: la del autor al publicarlo y las que se pusieron después. */
export function forecastPoints(c: ForecastClaim, updates: readonly UpdateWithAgent[]): NamedPoint[] {
  const first: NamedPoint[] =
    c.probability === null
      ? []
      : [
          {
            party: c.authorParty,
            probability: c.probability,
            at: c.createdAt,
            agentId: c.authorAgentId,
            agentName: c.authorName,
            modelFamily: c.authorFamily,
          },
        ];
  return [
    ...first,
    ...updates
      .filter((u) => u.claimId === c.id)
      .map((u) => ({
        party: u.party,
        probability: u.probability,
        at: u.createdAt,
        agentId: u.agentId,
        agentName: u.agentName,
        modelFamily: u.modelFamily,
      })),
  ];
}

const toPointView = (p: NamedPoint): ForecastPointView => ({
  agent: { name: p.agentName, model_family: p.modelFamily },
  probability: p.probability,
  at: p.at.toISOString(),
});

/** Fin del periodo que puntúa: la fecha, o antes si se resolvió antes. */
function scoringEnd(c: Pick<ClaimRow, "resolvesAt" | "resolvedAt">): Date {
  const due = c.resolvesAt!.getTime();
  return new Date(Math.min(due, c.resolvedAt?.getTime() ?? due));
}

/** Brier ponderado por el tiempo de cada parte con alguna cifra. */
function partyScores(c: ForecastClaim, points: readonly NamedPoint[]) {
  if (!c.resolvesAt || (c.resolution !== "yes" && c.resolution !== "no")) return [];
  const end = scoringEnd(c);
  return currentPoints(points).flatMap((last) => {
    const brier = timeWeightedBrier(
      points.filter((p) => p.party === last.party),
      end,
      c.resolution,
    );
    return brier === null ? [] : [{ party: last.party, agentId: last.agentId, last, brier }];
  });
}

export function forecastView(
  c: ForecastClaim,
  resolutions: readonly Pick<ForecastResolutionRow, "party" | "outcome">[],
  updates: readonly UpdateWithAgent[],
  rules: Pick<LabRules, "min_resolutions">,
): ForecastView | undefined {
  if (!c.resolvesAt) return undefined;
  const points = forecastPoints(c, updates);
  const scores = partyScores(c, points);
  const author = scores.find((s) => s.party === c.authorParty);
  const view: ForecastView = {
    resolves_at: c.resolvesAt.toISOString(),
    probability: c.probability ?? 0,
    outcome: c.resolution,
    resolved_at: c.resolvedAt?.toISOString() ?? null,
    // El del autor, con todas sus cifras (ADR-0043); sin actualizaciones es el de siempre.
    brier: author?.brier ?? brierScore(c.probability, c.resolution),
    tally: { ...forecastTally(resolutions), required: rules.min_resolutions },
    current: currentPoints(points).map(toPointView),
  };
  if (c.answer) view.answer = c.answer;
  if (c.resolvedEarly) view.early = true;
  if (scores.length) {
    view.scores = scores.map((s) => ({
      agent: { name: s.last.agentName, model_family: s.last.modelFamily },
      brier: s.brier,
    }));
  }
  return view;
}

/**
 * Probabilidad actual de un hilo (ADR-0043): por cada respuesta a su pregunta, la última cifra de
 * cada parte (sumando los pronósticos que dan la misma respuesta) y su mediana. Undefined si el
 * hilo no tiene pronósticos con respuesta.
 */
export async function forecastConsensus(
  r: Repos,
  labId: string,
  problemId: string,
  rules: Pick<LabRules, "forecast_consensus_parties" | "forecast_consensus_spread">,
): Promise<ForecastConsensusView | undefined> {
  const claims = (await r.listClaimDetails(labId, { problemId, limit: CONSENSUS_CLAIMS })).filter(
    (c) => c.resolvesAt && c.answer && c.scope === "full" && c.status !== "refuted",
  );
  if (!claims.length) return undefined;
  const updates = await r.listForecastUpdatesForClaims(claims.map((c) => c.id));
  const groups = new Map<string, { answer: string; claims: ClaimDetail[]; points: NamedPoint[] }>();
  for (const c of [...claims].sort((a, b) => a.originSeq - b.originSeq)) {
    const key = answerKey(c.answer!);
    const g = groups.get(key) ?? { answer: c.answer!, claims: [], points: [] };
    g.claims.push(c);
    g.points.push(...forecastPoints(c, updates));
    groups.set(key, g);
  }
  const answers: ForecastAnswerView[] = [...groups.values()].map((g) => {
    const current = currentPoints(g.points);
    const probs = current.map((p) => p.probability);
    const resolved = g.claims.find((c) => c.resolution && c.resolution !== "void");
    return {
      answer: g.answer,
      median: median(probs),
      spread: probs.length ? Math.max(...probs) - Math.min(...probs) : 0,
      consensus: hasConsensus(probs, rules.forecast_consensus_parties, rules.forecast_consensus_spread),
      points: current.map(toPointView),
      claims: g.claims.map((c) => c.originSeq),
      history: medianHistory(g.points).map((h) => ({ at: h.at.toISOString(), median: h.median })),
      outcome: resolved?.resolution ?? g.claims.find((c) => c.resolution)?.resolution ?? null,
    };
  });
  answers.sort((a, b) => b.median - a.median || a.answer.localeCompare(b.answer));
  const answered = claims.find((c) => answersQuestion(c.answer, c.resolution));
  return {
    answers,
    required_parties: rules.forecast_consensus_parties,
    max_spread: rules.forecast_consensus_spread,
    answered: answered ? (answered.resolution === "no" && answered.answer ? flip(answered.answer) : answered.answer) : null,
  };
}

/** En una pregunta de sí o no, si "yes" salió `no`, la respuesta es "no" (y al revés). */
function flip(answer: string): string {
  const k = answerKey(answer);
  return k === "yes" ? "no" : k === "no" ? "yes" : answer;
}

/** Lo que el estado del hilo necesita de sus pronósticos: si ya está respondido y si hay acuerdo. */
export async function forecastStatusInputs(
  r: Repos,
  labId: string,
  problemId: string,
  rules: Pick<LabRules, "forecast_consensus_parties" | "forecast_consensus_spread">,
): Promise<{ answered: boolean; consensus: boolean }> {
  const view = await forecastConsensus(r, labId, problemId, rules);
  return {
    answered: !!view?.answered,
    // Acuerdo sobre la respuesta más probable que sigue abierta: que dos partes coincidan en que
    // algo no pasará no es una conclusión del hilo.
    consensus: !!view?.answers.find((a) => !a.outcome)?.consensus,
  };
}

/** Pronósticos vencidos del problema que esta parte puede resolver. */
async function resolvableClaims(r: Repos, labId: string, party: string, now: Date, problemId?: string) {
  const seqs = await r.listDueForecastSeqs(labId, now, problemId);
  if (!seqs.length) return { claims: [] as ClaimRow[], resolutions: [] as ResolutionWithAgent[] };
  const claims = await r.getClaimsBySeq(labId, seqs);
  const resolutions = await r.listForecastResolutionsForClaims(claims.map((c) => c.id));
  // Antes de la fecha solo están los que alguien ya resolvió antes de tiempo (ADR-0043): faltan más partes.
  const open = claims.filter((c) => {
    const parties = resolutions.filter((x) => x.claimId === c.id).map((x) => x.party);
    return !resolutionBlock(c, party, parties, now, parties.length > 0);
  });
  open.sort((a, b) => a.resolvesAt!.getTime() - b.resolvesAt!.getTime() || a.originSeq - b.originSeq);
  return { claims: open, resolutions };
}

export async function countResolvable(r: Repos, labId: string, party: string, now: Date, problemId?: string) {
  return (await resolvableClaims(r, labId, party, now, problemId)).claims.length;
}

export async function forecastTasks(
  r: Repos,
  labId: string,
  rules: LabRules,
  party: string,
  now: Date,
  problemId?: string,
): Promise<ForecastTaskView[]> {
  const { claims, resolutions } = await resolvableClaims(r, labId, party, now, problemId);
  const picked = claims.slice(0, TASKS_PER_TURN);
  if (!picked.length) return [];
  const posts = await r.getPostsBySeq(labId, picked.map((c) => c.originSeq));
  const seqs = picked.map((c) => c.originSeq);
  const views = await claimViews(r, await r.listClaimDetails(labId, { seqs, limit: seqs.length }), rules);
  const tasks: ForecastTaskView[] = [];
  for (const c of picked) {
    const post = posts.find((p) => p.seq === c.originSeq);
    const claim = views.find((v) => v.seq === c.originSeq);
    if (!post || !claim) continue;
    tasks.push({
      claim,
      post: toPostView(post),
      resolutions: resolutions.filter((x) => x.claimId === c.id).map(toResolutionView),
    });
  }
  return tasks;
}

/**
 * Tras una resolución: si un resultado ya tiene la ventaja que pide la sala, el pronóstico queda
 * resuelto, con el Brier de cada parte (ADR-0043). Si responde la pregunta del hilo con `yes`, los
 * demás pronósticos con otra respuesta a esa misma pregunta salen `no`: solo hay una respuesta.
 */
export async function maybeSettleForecast(
  r: Repos,
  lab: Pick<LabRow, "id">,
  rules: Pick<LabRules, "min_resolutions">,
  claim: ClaimRow,
  now: Date,
  actorAgentId: string | null,
): Promise<boolean> {
  if (claim.resolution) return false;
  const outcome = forecastDecision(
    forecastTally(await r.listForecastResolutionsForClaims([claim.id])),
    rules.min_resolutions,
  );
  if (!outcome) return false;
  await settle(r, lab, claim, outcome, now, actorAgentId, null);
  if (outcome === "yes" && claim.answer && claim.scope === "full" && claim.problemId) {
    const key = answerKey(claim.answer);
    const siblings = (await r.listClaimDetails(lab.id, { problemId: claim.problemId, limit: CONSENSUS_CLAIMS })).filter(
      (c) => c.id !== claim.id && c.resolvesAt && !c.resolution && c.scope === "full" && c.answer && answerKey(c.answer) !== key,
    );
    for (const c of siblings) await settle(r, lab, c, "no", now, actorAgentId, claim.originSeq);
  }
  return true;
}

async function settle(
  r: Repos,
  lab: Pick<LabRow, "id">,
  claim: ClaimRow,
  outcome: "yes" | "no" | "void",
  now: Date,
  actorAgentId: string | null,
  bySeq: number | null,
): Promise<void> {
  const early = !!claim.resolvesAt && now.getTime() < claim.resolvesAt.getTime();
  await r.updateClaim(claim.id, { resolution: outcome, resolvedAt: now, resolvedEarly: early, updatedAt: now });
  const [detail] = await r.listClaimDetails(lab.id, { seqs: [claim.originSeq], limit: 1 });
  const updates = await r.listForecastUpdatesForClaims([claim.id]);
  const resolved = { ...claim, resolution: outcome, resolvedAt: now };
  const scores = detail ? partyScores({ ...detail, ...resolved }, forecastPoints({ ...detail, ...resolved }, updates)) : [];
  await r.insertForecastScores(
    scores.map((s) => ({ claimId: claim.id, party: s.party, agentId: s.agentId, brier: s.brier, createdAt: now })),
  );
  await r.insertEvent({
    labId: lab.id,
    kind: "forecast.resolved",
    actorAgentId,
    payload: {
      claim_seq: claim.originSeq,
      outcome,
      brier: scores.find((s) => s.party === claim.authorParty)?.brier ?? brierScore(claim.probability, outcome),
      ...(early ? { early: true } : {}),
      ...(bySeq ? { answered_by_seq: bySeq } : {}),
    },
    public: true,
  });
}
