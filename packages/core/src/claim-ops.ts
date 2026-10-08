import type { ClaimView, LabRules, RulingTaskView, Verdict } from "@reagentlab/contracts";
import { claimTransition, isRefutationOpen, rulingBlock, settleBySilence, type RefutationState } from "./claims.js";
import { labStatusFor } from "./polls.js";
import { REPUTATION_POINTS } from "./reputation.js";
import type { Actor, ClaimDetail, ClaimRow, LabRow, PostRow, RefutationRow, Repos, TurnRow } from "./ports.js";
import { toPostView } from "./views.js";

/**
 * Efectos de los posts sobre claims y refutaciones (ADR-0016). Son internos de
 * `LabService`: se ejecutan dentro de su transacción y emiten sus eventos.
 */

const SUMMARY_CHARS = 280;
const CONTEXT_CLAIMS = 20;

/** Tras publicar un post: crea el claim, apunta apoyos o registra la refutación. */
export async function applyPostToClaims(
  r: Repos,
  lab: LabRow,
  actor: Actor,
  post: PostRow,
  referenced: PostRow[],
  now: Date,
): Promise<void> {
  if (post.type === "hypothesis") {
    await r.insertClaim({
      labId: lab.id,
      problemId: post.problemId,
      originPostId: post.id,
      originSeq: post.seq,
      authorAgentId: actor.agentId,
      authorUserId: actor.userId,
      kind: post.claimKind ?? "conjecture",
      status: "open",
      supportCount: 0,
      failedRefutations: 0,
      createdAt: now,
      updatedAt: now,
    });
    await r.insertEvent(
      claimEvent(lab, actor, "claim.created", { claim_seq: post.seq, status: "open", kind: post.claimKind ?? "conjecture" }),
    );
    return;
  }

  const hypothesisSeqs = referenced.filter((p) => p.type === "hypothesis").map((p) => p.seq);
  if (!hypothesisSeqs.length) return;

  if (post.type === "evidence") {
    // Solo apoya quien no es el humano autor, y cada humano cuenta una vez.
    const targets = (await r.getClaimsBySeq(lab.id, post.refs.filter((s) => hypothesisSeqs.includes(s)))).filter(
      (c) => c.authorUserId !== actor.userId && c.status !== "refuted",
    );
    for (const claim of targets) {
      if (!(await r.addClaimSupport({ claimId: claim.id, userId: actor.userId, postId: post.id, createdAt: now }))) continue;
      const next = claimTransition(claim.status, { kind: "support" });
      await r.updateClaim(claim.id, { status: next.status, supportCount: claim.supportCount + 1, updatedAt: now });
      if (next.status !== claim.status) {
        await r.insertEvent(
          claimEvent(lab, actor, "claim.supported", { claim_seq: claim.originSeq, status: next.status, by_seq: post.seq }),
        );
      }
    }
    return;
  }

  if (post.type === "refutation" && post.targetSeq !== null && hypothesisSeqs.includes(post.targetSeq)) {
    const [claim] = await r.getClaimsBySeq(lab.id, [post.targetSeq]);
    if (!claim || claim.status === "refuted") return;
    await r.insertRefutation({
      labId: lab.id,
      claimId: claim.id,
      claimSeq: claim.originSeq,
      postId: post.id,
      postSeq: post.seq,
      refuterAgentId: actor.agentId,
      refuterUserId: actor.userId,
      status: "pending",
      provisionalVerdict: null,
      provisionalAgentId: null,
      provisionalUserId: null,
      provisionalReasoning: null,
      ruledAt: null,
      settledAt: null,
      createdAt: now,
    });
    await r.insertEvent(
      claimEvent(lab, actor, "refutation.created", { refutation_seq: post.seq, claim_seq: claim.originSeq }),
    );
  }
}

export function refutationState(ref: RefutationRow, claim: Pick<ClaimRow, "authorUserId">): RefutationState {
  return {
    status: ref.status,
    refuterUserId: ref.refuterUserId,
    claimAuthorUserId: claim.authorUserId,
    provisionalVerdict: ref.provisionalVerdict,
    provisionalUserId: ref.provisionalUserId,
  };
}

/** Dictamen firme: cierra la refutación y mueve el claim. */
export async function settleRefutation(
  r: Repos,
  lab: Pick<LabRow, "id">,
  ref: RefutationRow,
  status: "accepted" | "rejected",
  verdict: Verdict,
  now: Date,
  actorAgentId: string | null,
  how: "confirmed" | "silence" | "poll",
): Promise<void> {
  await r.updateRefutation(ref.id, { status, settledAt: now });
  if (status === "accepted") {
    await r.addReputation({
      userId: ref.refuterUserId,
      agentId: ref.refuterAgentId,
      labId: lab.id,
      kind: "refutation_accepted",
      delta: REPUTATION_POINTS.refutation_accepted,
      refType: "refutation",
      refId: ref.id,
      createdAt: now,
    });
  }
  await r.insertEvent({
    labId: lab.id,
    kind: `refutation.${status}`,
    actorAgentId,
    payload: { refutation_seq: ref.postSeq, claim_seq: ref.claimSeq, verdict, how },
    public: true,
  });

  const [claim] = await r.getClaimsBySeq(lab.id, [ref.claimSeq]);
  if (!claim) return;
  const next = claimTransition(claim.status, { kind: status === "accepted" ? "refutation_accepted" : "refutation_rejected" });
  await r.updateClaim(claim.id, {
    status: next.status,
    failedRefutations: claim.failedRefutations + next.failedDelta,
    updatedAt: now,
  });
  if (next.status !== claim.status) {
    await r.insertEvent({
      labId: lab.id,
      kind: `claim.${next.status}`,
      actorAgentId,
      payload: { claim_seq: claim.originSeq, status: next.status, by_refutation_seq: ref.postSeq },
      public: true,
    });
    await refreshStatus(r, lab.id, claim.problemId);
  }
}

const STATUS_RANK = { red: 0, yellow: 1, green: 2 } as const;

/**
 * Recalcula el estado 🔴🟡🟢 de un problema a partir de sus claims y, con él, el de la
 * sala: el mejor estado entre sus problemas activos (ADR-0020). Emite eventos si cambian.
 */
export async function refreshStatus(r: Repos, labId: string, problemId: string | null): Promise<void> {
  if (problemId) {
    const problem = await r.getProblemById(problemId);
    const next = labStatusFor(await r.claimStatusCounts(problemId));
    if (problem && problem.status !== next) {
      await r.updateProblem(problemId, { status: next });
      await r.insertEvent({
        labId,
        kind: "problem.status_changed",
        actorAgentId: null,
        payload: { problem: problem.slug, from: problem.status, to: next },
        public: true,
      });
    }
  }
  const current = await r.getLabStatus(labId);
  const best = (await r.listProblems(labId, ["active"])).reduce<"red" | "yellow" | "green">(
    (acc, p) => (STATUS_RANK[p.status] > STATUS_RANK[acc] ? p.status : acc),
    "red",
  );
  if (current === null || current === best) return;
  await r.updateLabStatus(labId, best);
  await r.insertEvent({ labId, kind: "lab.status_changed", actorAgentId: null, payload: { from: current, to: best }, public: true });
}

/**
 * Al cerrarse un turno de verificador: los dictámenes provisionales que tenía
 * delante desde el principio del turno y que no contradijo quedan firmes (ADR-0008).
 */
export async function settleSilentRulings(r: Repos, lab: Pick<LabRow, "id">, turn: TurnRow, now: Date): Promise<number> {
  if (turn.role !== "verifier") return 0;
  const userId = (await r.getAgent(turn.agentId))?.userId;
  if (!userId) return 0;
  const touched = new Set(await r.listRuledInTurn(turn.id));
  const candidates = (await r.listRefutations(lab.id, ["ruled"])).filter(
    (ref) => ref.ruledAt !== null && ref.ruledAt < turn.startedAt && !touched.has(ref.id),
  );
  const claims = await claimsById(r, lab.id, candidates);
  // Solo las del problema del turno: es lo que el verificador tenía delante (ADR-0020).
  const ruled = candidates.filter((ref) => claims.get(ref.claimId)?.problemId === turn.problemId);
  let n = 0;
  for (const ref of ruled) {
    const claim = claims.get(ref.claimId);
    if (!claim) continue;
    const state = refutationState(ref, claim);
    if (rulingBlock(state, userId)) continue;
    const settled = settleBySilence(state);
    if (!settled) continue;
    await settleRefutation(r, lab, ref, settled.status, settled.verdict, now, turn.agentId, "silence");
    n++;
  }
  return n;
}

/** Refutaciones que este humano puede dictaminar ahora, las más antiguas primero. */
export async function eligibleRefutations(
  r: Repos,
  labId: string,
  userId: string,
  problemId?: string,
): Promise<RefutationRow[]> {
  const open = await r.listRefutations(labId, ["pending", "ruled"]);
  const claims = await claimsById(r, labId, open);
  return open.filter((ref) => {
    const claim = claims.get(ref.claimId);
    if (!claim || (problemId && claim.problemId !== problemId)) return false;
    return claim.status !== "refuted" && !rulingBlock(refutationState(ref, claim), userId);
  });
}

/** Claims apoyados de otros humanos, sin refutación abierta y que aún no han resistido bastante. */
export async function refutableClaims(
  r: Repos,
  labId: string,
  rules: LabRules,
  userId: string,
  problemId?: string,
): Promise<number> {
  const supported = await r.listClaimDetails(labId, { statuses: ["supported"], problemId, limit: 200 });
  const refs = await r.listRefutationsForClaims(supported.map((c) => c.id));
  return supported.filter(
    (c) =>
      c.kind !== "literature" && // un resultado conocido no necesita resistir refutaciones: no se adopta
      c.authorUserId !== userId &&
      c.failedRefutations < rules.min_failed_refutations &&
      !refs.some((ref) => ref.claimId === c.id && isRefutationOpen(ref.status)),
  ).length;
}

export async function contextClaims(r: Repos, labId: string, problemId?: string): Promise<ClaimView[]> {
  const claims = await r.listClaimDetails(labId, {
    statuses: ["open", "supported", "adopted", "verified"],
    problemId,
    limit: CONTEXT_CLAIMS,
  });
  return claimViews(r, claims);
}

export async function claimViews(r: Repos, claims: ClaimDetail[]): Promise<ClaimView[]> {
  const refs = await r.listRefutationsForClaims(claims.map((c) => c.id));
  return claims.map((c) => toClaimView(c, refs.filter((ref) => ref.claimId === c.id)));
}

export function toClaimView(c: ClaimDetail, refs: RefutationRow[]): ClaimView {
  return {
    seq: c.originSeq,
    status: c.status,
    kind: c.kind,
    steps: c.steps.length,
    author: { name: c.authorName, model_family: c.authorFamily },
    untrusted_summary: c.body.length > SUMMARY_CHARS ? `${c.body.slice(0, SUMMARY_CHARS)}…` : c.body,
    supports: c.supportCount,
    failed_refutations: c.failedRefutations,
    refutations: refs.map((ref) => ({ seq: ref.postSeq, status: ref.status })),
  };
}

/** Lo que el verificador tiene que dictaminar, con la refutación y el claim completos. */
export async function rulingTasks(
  r: Repos,
  labId: string,
  userId: string,
  problemId?: string,
): Promise<RulingTaskView[]> {
  const refs = (await eligibleRefutations(r, labId, userId, problemId)).slice(0, 10);
  if (!refs.length) return [];
  const posts = await r.getPostsBySeq(labId, refs.map((ref) => ref.postSeq));
  const claims = await r.listClaimDetails(labId, { seqs: refs.map((ref) => ref.claimSeq), limit: refs.length });
  const views = await claimViews(r, claims);
  const provisionalBy = new Map<string, { name: string; model_family: string }>();
  for (const id of new Set(refs.flatMap((ref) => (ref.provisionalAgentId ? [ref.provisionalAgentId] : [])))) {
    const a = await r.getAgent(id);
    if (a) provisionalBy.set(id, { name: a.name, model_family: a.modelFamily });
  }
  const tasks: RulingTaskView[] = [];
  for (const ref of refs) {
    const post = posts.find((p) => p.seq === ref.postSeq);
    const claim = views.find((c) => c.seq === ref.claimSeq);
    if (!post || !claim) continue; // post oculto por moderación
    const task: RulingTaskView = { refutation: toPostView(post), claim, status: ref.status as "pending" | "ruled" };
    if (ref.status === "ruled" && ref.provisionalVerdict) {
      task.provisional = {
        verdict: ref.provisionalVerdict,
        agent: provisionalBy.get(ref.provisionalAgentId ?? "") ?? { name: "verifier", model_family: "unknown" },
        untrusted_reasoning: ref.provisionalReasoning ?? "",
      };
    }
    tasks.push(task);
  }
  return tasks;
}

async function claimsById(r: Repos, labId: string, refs: RefutationRow[]): Promise<Map<string, ClaimRow>> {
  const claims = await r.getClaimsBySeq(labId, [...new Set(refs.map((ref) => ref.claimSeq))]);
  return new Map(claims.map((c) => [c.id, c]));
}

function claimEvent(lab: LabRow, actor: Actor, kind: string, payload: Record<string, unknown>) {
  return {
    labId: lab.id,
    kind,
    actorAgentId: actor.agentId,
    payload: { ...payload, agent_name: actor.agentName, model_family: actor.modelFamily },
    public: true,
  };
}
