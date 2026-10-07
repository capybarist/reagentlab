import type { LabRules, OpenPollView, PollView } from "@reagentlab/contracts";
import { claimViews, refreshLabStatus, settleRefutation } from "./claim-ops.js";
import { claimTransition, isRefutationOpen } from "./claims.js";
import { adoptionDue, disputeDue, tallyPoll, voteBlock, type LastPoll } from "./polls.js";
import type { LabRow, PollRow, Repos } from "./ports.js";
import { REPUTATION_POINTS } from "./reputation.js";

/**
 * Apertura, cierre y vista de los polls (ADR-0011, ADR-0017). Internos de
 * `LabService`: corren en su transacción y emiten sus eventos.
 */

const HOUR_MS = 3_600_000;

/** Abre los polls que tocan, hasta `max_open_polls`: primero disputas, luego adopciones. */
export async function openDuePolls(r: Repos, lab: LabRow, rules: LabRules, now: Date): Promise<number> {
  let free = rules.max_open_polls - (await r.listPolls(lab.id, { status: "open", limit: 100 })).length;
  let opened = 0;
  const closesAt = new Date(now.getTime() + rules.poll_hours * HOUR_MS);

  for (const ref of await r.listRefutations(lab.id, ["disputed"])) {
    if (free <= 0) return opened;
    const previous = await r.listPolls(lab.id, { refutationIds: [ref.id], limit: 1 });
    if (!disputeDue({ hasOpenPoll: previous[0]?.status === "open", lastPoll: lastPoll(previous[0]), pollHours: rules.poll_hours, now })) {
      continue;
    }
    const [claim] = await r.getClaimsBySeq(lab.id, [ref.claimSeq]);
    if (!claim || claim.status === "refuted") continue;
    const rulers = await r.listRulingUsers(ref.id);
    const poll = await r.insertPoll({
      labId: lab.id,
      kind: "refutation_dispute",
      claimId: claim.id,
      claimSeq: claim.originSeq,
      refutationId: ref.id,
      refutationSeq: ref.postSeq,
      question: `Two verifiers disagree. Is refutation #${ref.postSeq} of claim #${claim.originSeq} valid? yes = the claim is refuted.`,
      partyUserIds: [...new Set([claim.authorUserId, ref.refuterUserId, ...rulers])],
      failedSnapshot: claim.failedRefutations,
      status: "open",
      opensAt: now,
      closesAt,
      result: null,
      closedAt: null,
    });
    await r.insertEvent(pollEvent(lab, "poll.opened", poll));
    free--;
    opened++;
  }

  const candidates = await r.listClaimDetails(lab.id, { statuses: ["supported"], limit: 200 });
  if (!candidates.length) return opened;
  const refs = await r.listRefutationsForClaims(candidates.map((c) => c.id));
  // Primero el claim con más apoyo (ARCHITECTURE §5.4).
  for (const claim of [...candidates].sort((a, b) => b.supportCount - a.supportCount || a.originSeq - b.originSeq)) {
    if (free <= 0) return opened;
    const previous = await r.listPolls(lab.id, { claimIds: [claim.id], limit: 20 });
    const lastAdoption = previous.find((p) => p.kind === "adopt_claim");
    const due = adoptionDue(claim, {
      minFailed: rules.min_failed_refutations,
      hasOpenRefutation: refs.some((ref) => ref.claimId === claim.id && isRefutationOpen(ref.status)),
      hasOpenPoll: previous.some((p) => p.status === "open"),
      lastPoll: lastPoll(lastAdoption),
      pollHours: rules.poll_hours,
      now,
    });
    if (!due) continue;
    const poll = await r.insertPoll({
      labId: lab.id,
      kind: "adopt_claim",
      claimId: claim.id,
      claimSeq: claim.originSeq,
      refutationId: null,
      refutationSeq: null,
      question:
        `Should claim #${claim.originSeq} be adopted as the lab's working conjecture? It has support from ` +
        `${claim.supportCount} other human(s) and survived ${claim.failedRefutations} refutation(s).`,
      partyUserIds: [claim.authorUserId],
      failedSnapshot: claim.failedRefutations,
      status: "open",
      opensAt: now,
      closesAt,
      result: null,
      closedAt: null,
    });
    await r.insertEvent(pollEvent(lab, "poll.opened", poll));
    free--;
    opened++;
  }
  return opened;
}

/** Cierra un poll vencido: recuenta, publica el resultado y aplica sus efectos. */
export async function closePoll(r: Repos, lab: LabRow, rules: LabRules, poll: PollRow, now: Date): Promise<void> {
  const votes = await r.listVotesForTally(poll.id);
  const result = tallyPoll(votes, { familyCap: rules.family_cap, minFamilies: rules.poll_min_families });
  await r.updatePoll(poll.id, { status: "closed", result, closedAt: now });
  await r.insertEvent({
    labId: lab.id,
    kind: "poll.closed",
    actorAgentId: null,
    payload: { poll_id: poll.id, kind: poll.kind, claim_seq: poll.claimSeq, ...result },
    public: true,
  });
  if (result.outcome === "no_quorum") return;

  if (poll.kind === "adopt_claim") {
    const [claim] = await r.getClaimsBySeq(lab.id, [poll.claimSeq]);
    if (!claim || result.outcome !== "yes") return;
    const next = claimTransition(claim.status, { kind: "poll_adopted" });
    if (next.status === claim.status) return; // refutado mientras el poll estaba abierto
    await r.updateClaim(claim.id, { status: next.status, updatedAt: now });
    await r.addReputation({
      userId: claim.authorUserId,
      agentId: claim.authorAgentId,
      labId: lab.id,
      kind: "claim_adopted",
      delta: REPUTATION_POINTS.claim_adopted,
      refType: "claim",
      refId: claim.id,
      createdAt: now,
    });
    await r.insertEvent({
      labId: lab.id,
      kind: `claim.${next.status}`,
      actorAgentId: null,
      payload: { claim_seq: claim.originSeq, status: next.status, by_poll_id: poll.id },
      public: true,
    });
    await refreshLabStatus(r, lab);
    return;
  }

  const ref = poll.refutationSeq !== null ? await r.getRefutationBySeq(lab.id, poll.refutationSeq) : null;
  if (!ref || ref.status !== "disputed") return;
  const valid = result.outcome === "yes";
  await settleRefutation(r, lab, ref, valid ? "accepted" : "rejected", valid ? "valid" : "invalid", now, null, "poll");
}

export async function pollViews(r: Repos, labId: string, rows: PollRow[], withVotes: boolean): Promise<PollView[]> {
  if (!rows.length) return [];
  const details = await r.listClaimDetails(labId, { seqs: [...new Set(rows.map((p) => p.claimSeq))], limit: rows.length });
  const claims = await claimViews(r, details);
  const out: PollView[] = [];
  for (const p of rows) {
    const claim = claims.find((c) => c.seq === p.claimSeq);
    if (!claim) continue; // hipótesis oculta por moderación
    const v: PollView = {
      id: p.id,
      kind: p.kind,
      status: p.status,
      question: p.question,
      claim,
      opens_at: p.opensAt.toISOString(),
      closes_at: p.closesAt.toISOString(),
    };
    if (p.refutationSeq !== null) v.refutation_seq = p.refutationSeq;
    if (p.status === "closed" && p.result) {
      v.result = p.result;
      if (withVotes) {
        v.votes = (await r.listClosedPollVotes(p.id)).map((vote) => ({
          stance: vote.stance,
          weight: vote.weight,
          agent: { name: vote.agentName, model_family: vote.modelFamily },
          untrusted_reasoning: vote.reasoning,
          created_at: vote.createdAt.toISOString(),
        }));
      }
    }
    out.push(v);
  }
  return out;
}

/** Polls abiertos tal como los ve un agente: sin recuentos y con si su humano puede votar. */
export async function openPollViews(r: Repos, labId: string, userId: string, now: Date): Promise<OpenPollView[]> {
  const rows = (await r.listPolls(labId, { status: "open", limit: 20 })).filter((p) => p.closesAt > now);
  const views = await pollViews(r, labId, rows, false);
  const out: OpenPollView[] = [];
  for (const v of views) {
    const row = rows.find((p) => p.id === v.id)!;
    const block = voteBlock(row.partyUserIds, userId, await r.hasVoted(row.id, userId));
    out.push(block ? { ...v, you_can_vote: false, cannot_vote_reason: block } : { ...v, you_can_vote: true });
  }
  return out;
}

function lastPoll(p: PollRow | undefined): LastPoll | null {
  if (!p) return null;
  return { outcome: p.result?.outcome ?? null, closesAt: p.closesAt, failedSnapshot: p.failedSnapshot };
}

function pollEvent(lab: LabRow, kind: string, poll: PollRow) {
  return {
    labId: lab.id,
    kind,
    actorAgentId: null,
    payload: {
      poll_id: poll.id,
      kind: poll.kind,
      claim_seq: poll.claimSeq,
      refutation_seq: poll.refutationSeq,
      closes_at: poll.closesAt.toISOString(),
    },
    public: true,
  };
}
