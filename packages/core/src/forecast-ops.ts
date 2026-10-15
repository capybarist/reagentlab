import type { ForecastResolutionView, ForecastTaskView, ForecastView, LabRules } from "@reagentlab/contracts";
import { claimViews } from "./claim-ops.js";
import { brierScore, forecastDecision, forecastTally, resolutionBlock } from "./forecast.js";
import type { ClaimRow, ForecastResolutionRow, LabRow, Repos } from "./ports.js";
import { toPostView } from "./views.js";

/**
 * Efectos de los pronósticos (ADR-0029). Internos de `LabService`: corren dentro de su
 * transacción y emiten sus eventos.
 */

const TASKS_PER_TURN = 5;

type ResolutionWithAgent = ForecastResolutionRow & { agentName: string; modelFamily: string };

export function toResolutionView(r: ResolutionWithAgent): ForecastResolutionView {
  return {
    outcome: r.outcome,
    source_url: r.sourceUrl,
    untrusted_reasoning: r.reasoning,
    agent: { name: r.agentName, model_family: r.modelFamily },
    created_at: r.createdAt.toISOString(),
  };
}

export function forecastView(
  c: Pick<ClaimRow, "resolvesAt" | "probability" | "resolution" | "resolvedAt">,
  resolutions: readonly Pick<ForecastResolutionRow, "party" | "outcome">[],
  rules: Pick<LabRules, "min_resolutions">,
): ForecastView | undefined {
  if (!c.resolvesAt) return undefined;
  return {
    resolves_at: c.resolvesAt.toISOString(),
    probability: c.probability ?? 0,
    outcome: c.resolution,
    resolved_at: c.resolvedAt?.toISOString() ?? null,
    brier: brierScore(c.probability, c.resolution),
    tally: { ...forecastTally(resolutions), required: rules.min_resolutions },
  };
}

/** Pronósticos vencidos del problema que esta parte puede resolver. */
async function resolvableClaims(r: Repos, labId: string, party: string, now: Date, problemId?: string) {
  const seqs = await r.listDueForecastSeqs(labId, now, problemId);
  if (!seqs.length) return { claims: [] as ClaimRow[], resolutions: [] as ResolutionWithAgent[] };
  const claims = await r.getClaimsBySeq(labId, seqs);
  const resolutions = await r.listForecastResolutionsForClaims(claims.map((c) => c.id));
  const open = claims.filter(
    (c) =>
      !resolutionBlock(
        c,
        party,
        resolutions.filter((x) => x.claimId === c.id).map((x) => x.party),
        now,
      ),
  );
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

/** Tras una resolución: si un resultado ya tiene la ventaja que pide la sala, el pronóstico queda resuelto. */
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
  await r.updateClaim(claim.id, { resolution: outcome, resolvedAt: now, updatedAt: now });
  await r.insertEvent({
    labId: lab.id,
    kind: "forecast.resolved",
    actorAgentId,
    payload: { claim_seq: claim.originSeq, outcome, brier: brierScore(claim.probability, outcome) },
    public: true,
  });
  return true;
}
