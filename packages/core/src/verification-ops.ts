import type { LabRules, VerificationTallyView, VerificationTaskView } from "@reagentlab/contracts";
import { claimTransition } from "./claims.js";
import { claimViews, refreshStatus } from "./claim-ops.js";
import type { ClaimDetail, ClaimRow, LabRow, Repos, VerificationRow } from "./ports.js";
import { REPUTATION_POINTS } from "./reputation.js";
import { readyForGreen, requiredFor, tally, verificationBlock, verificationKindOf } from "./verification.js";
import { toArtifactView, toPostView, toVerificationView } from "./views.js";

/**
 * Efectos de las verificaciones (ADR-0027). Internos de `LabService`: corren dentro de su
 * transacción y emiten sus eventos.
 */

const TASKS_PER_TURN = 3;
/** El verificador recibe trabajo de claims que alguien ya apoya: lo que va camino del verde. */
const TASK_STATUSES = ["adopted", "supported"] as const;

export function kindOfClaim(c: Pick<ClaimDetail, "kind" | "hasArtifact">, rules: LabRules) {
  return verificationKindOf({ kind: c.kind, hasArtifact: c.hasArtifact }, rules);
}

export function tallyView(
  c: Pick<ClaimDetail, "kind" | "hasArtifact">,
  verifications: readonly Pick<VerificationRow, "party" | "outcome">[],
  rules: LabRules,
): VerificationTallyView | undefined {
  const kind = kindOfClaim(c, rules);
  if (!kind) return undefined;
  return { kind, ...tally(verifications), required: requiredFor(kind, rules) };
}

/** Claims del problema que esta parte puede reproducir o revisar, los adoptados primero. */
async function verifiableClaims(r: Repos, labId: string, rules: LabRules, party: string, problemId?: string) {
  const claims = await r.listClaimDetails(labId, { statuses: [...TASK_STATUSES], problemId, limit: 200 });
  const verifs = await r.listVerificationsForClaims(claims.map((c) => c.id));
  const open = claims.filter((c) => {
    const parties = verifs.filter((v) => v.claimId === c.id).map((v) => v.party);
    return !verificationBlock({ status: c.status, authorParty: c.authorParty, kind: kindOfClaim(c, rules) }, party, parties);
  });
  open.sort((a, b) => (a.status === b.status ? a.originSeq - b.originSeq : a.status === "adopted" ? -1 : 1));
  return { claims: open, verifs };
}

export async function countVerifiable(r: Repos, labId: string, rules: LabRules, party: string, problemId?: string) {
  return (await verifiableClaims(r, labId, rules, party, problemId)).claims.length;
}

/** Lo que el verificador puede reproducir o revisar en este turno, con el artefacto completo. */
export async function verificationTasks(
  r: Repos,
  labId: string,
  rules: LabRules,
  party: string,
  problemId?: string,
): Promise<VerificationTaskView[]> {
  const { claims, verifs } = await verifiableClaims(r, labId, rules, party, problemId);
  const picked = claims.slice(0, TASKS_PER_TURN);
  if (!picked.length) return [];
  const posts = await r.getPostsBySeq(labId, picked.map((c) => c.originSeq));
  const views = await claimViews(r, picked, rules);
  const tasks: VerificationTaskView[] = [];
  for (const c of picked) {
    const post = posts.find((p) => p.seq === c.originSeq);
    const claim = views.find((v) => v.seq === c.originSeq);
    const kind = kindOfClaim(c, rules);
    if (!post || !claim || !kind) continue; // hipótesis oculta por moderación
    const artifact = kind === "artifact" ? toArtifactView(post) : null;
    tasks.push({
      kind,
      claim,
      post: toPostView(post),
      ...(artifact ? { artifact } : {}),
      verifications: verifs.filter((v) => v.claimId === c.id).map(toVerificationView),
    });
  }
  return tasks;
}

/**
 * Si el claim está adoptado y tiene confirmaciones netas suficientes, pasa a verde:
 * reputación para el autor y para quien lo confirmó, y estado del problema al día.
 */
export async function maybeVerify(
  r: Repos,
  lab: Pick<LabRow, "id">,
  rules: LabRules,
  claim: ClaimRow,
  now: Date,
  actorAgentId: string | null,
): Promise<boolean> {
  const [detail] = await r.listClaimDetails(lab.id, { seqs: [claim.originSeq], limit: 1 });
  if (!detail) return false;
  const kind = kindOfClaim(detail, rules);
  if (!kind) return false;
  const verifs = await r.listVerificationsForClaims([claim.id]);
  if (!readyForGreen(claim.status, tally(verifs), requiredFor(kind, rules))) return false;
  const next = claimTransition(claim.status, { kind: "verified" });
  if (next.status === claim.status) return false;
  await r.updateClaim(claim.id, { status: next.status, updatedAt: now });
  await r.addReputation({
    userId: claim.authorUserId,
    agentId: claim.authorAgentId,
    labId: lab.id,
    kind: "claim_verified",
    delta: REPUTATION_POINTS.claim_verified,
    refType: "claim",
    refId: claim.id,
    createdAt: now,
  });
  for (const v of verifs.filter((v) => v.outcome === "confirms")) {
    await r.addReputation({
      userId: v.userId,
      agentId: v.agentId,
      labId: lab.id,
      kind: "verification_correct",
      delta: REPUTATION_POINTS.verification_correct,
      refType: "verification",
      refId: v.id,
      createdAt: now,
    });
  }
  await r.insertEvent({
    labId: lab.id,
    kind: "claim.verified",
    actorAgentId,
    payload: { claim_seq: claim.originSeq, status: next.status, by: kind },
    public: true,
  });
  await refreshStatus(r, lab.id, claim.problemId);
  return true;
}
