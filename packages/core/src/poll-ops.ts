import type { LabRules, OpenPollView, PollView } from "@reagentlab/contracts";
import { claimViews, refreshStatus, settleRefutation } from "./claim-ops.js";
import { maybeVerify } from "./verification-ops.js";
import { claimTransition, isRefutationOpen } from "./claims.js";
import { adoptionDue, disputeDue, extensionDue, requiredFamilies, tallyPoll, voteBlock, type LastPoll } from "./polls.js";
import type { LabRow, PollRow, Repos } from "./ports.js";
import { partyOf, tallyFamily } from "./party.js";
import { REPUTATION_POINTS } from "./reputation.js";
import { templateFor } from "./templates/index.js";

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
    const rulerParties = await r.listRulingParties(ref.id);
    const poll = await r.insertPoll({
      labId: lab.id,
      problemId: claim.problemId,
      kind: "refutation_dispute",
      claimId: claim.id,
      claimSeq: claim.originSeq,
      refutationId: ref.id,
      refutationSeq: ref.postSeq,
      question: `Two verifiers disagree. Is refutation #${ref.postSeq} of claim #${claim.originSeq} valid? yes = the claim is refuted.`,
      partyUserIds: [...new Set([claim.authorUserId, ref.refuterUserId, ...rulers])],
      caseParties: [...new Set([claim.authorParty, ref.refuterParty, ...rulerParties])],
      failedSnapshot: claim.failedRefutations,
      status: "open",
      opensAt: now,
      closesAt,
      extensions: 0,
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
    const due = adoptionDue({ ...claim, adoptable: templateFor(rules).isAdoptable(claim.kind) }, {
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
      problemId: claim.problemId,
      kind: "adopt_claim",
      claimId: claim.id,
      claimSeq: claim.originSeq,
      refutationId: null,
      refutationSeq: null,
      question:
        `Should claim #${claim.originSeq} be adopted as the lab's working conjecture? It has support from ` +
        `${claim.supportCount} other ${rules.independence === "human" ? "human(s)" : "model family(ies)"} and survived ` +
        `${claim.failedRefutations} refutation(s).`,
      partyUserIds: [claim.authorUserId],
      caseParties: [claim.authorParty],
      failedSnapshot: claim.failedRefutations,
      status: "open",
      opensAt: now,
      closesAt,
      extensions: 0,
      result: null,
      closedAt: null,
    });
    await r.insertEvent(pollEvent(lab, "poll.opened", poll));
    free--;
    opened++;
  }
  return opened;
}

/**
 * Quién podía votar en el poll (ADR-0030): los agentes con turno en la sala en los últimos
 * `resident_idle_days` días y quienes ya han votado, sin las partes del caso. Devuelve sus
 * familias de recuento, cuántas partes elegibles no han votado y, para el último cierre
 * (ADR-0041), las familias de quienes votaron o tuvieron turno con el poll ya abierto.
 */
async function eligibility(r: Repos, lab: LabRow, rules: LabRules, poll: PollRow, votes: { party: string; modelFamily: string }[], now: Date) {
  const since = new Date(now.getTime() - rules.resident_idle_days * 24 * HOUR_MS);
  const voted = new Set(votes.map((v) => v.party));
  const families = new Set(votes.map((v) => tallyFamily(v)));
  const sawPoll = new Set(families);
  const pending = new Set<string>();
  for (const a of await r.listRecentLabAgents(lab.id, since)) {
    const party = partyOf(a, rules.independence);
    if (poll.caseParties.includes(party)) continue;
    families.add(tallyFamily({ party, modelFamily: a.modelFamily }));
    if (!voted.has(party)) pending.add(party);
  }
  for (const a of await r.listRecentLabAgents(lab.id, poll.opensAt)) {
    const party = partyOf(a, rules.independence);
    if (!poll.caseParties.includes(party)) sawPoll.add(tallyFamily({ party, modelFamily: a.modelFamily }));
  }
  return { families: families.size, pending: pending.size, sawPoll: sawPoll.size };
}

/**
 * Cierra un poll vencido: recuenta, publica el resultado y aplica sus efectos. Si no hay
 * quórum y aún quedan partes elegibles sin votar, lo alarga en vez de cerrarlo (ADR-0030)
 * y devuelve false.
 */
export async function closePoll(r: Repos, lab: LabRow, rules: LabRules, poll: PollRow, now: Date): Promise<boolean> {
  const votes = await r.listVotesForTally(poll.id);
  const eligible = await eligibility(r, lab, rules, poll, votes, now);
  const counted = votes.map((v) => ({ ...v, modelFamily: tallyFamily(v) }));
  const quorumOver = (families: number) => {
    const minFamilies = requiredFamilies(families, { minFamilies: rules.poll_min_families, floor: rules.poll_min_families_floor });
    const tally = tallyPoll(counted, { familyCap: rules.family_cap, minFamilies });
    return { ...tally, required_families: minFamilies, eligible_families: families };
  };
  let result = quorumOver(eligible.families);
  if (extensionDue(result.outcome, { extensions: poll.extensions, maxExtensions: rules.poll_max_extensions, pendingParties: eligible.pending })) {
    const closesAt = new Date(now.getTime() + rules.poll_hours * HOUR_MS);
    await r.updatePoll(poll.id, { closesAt, extensions: poll.extensions + 1 });
    // Sin recuentos: el poll sigue a ciegas.
    await r.insertEvent({
      labId: lab.id,
      kind: "poll.extended",
      actorAgentId: null,
      payload: { poll_id: poll.id, kind: poll.kind, claim_seq: poll.claimSeq, closes_at: closesAt.toISOString() },
      public: true,
    });
    return false;
  }
  // Último cierre sin quórum: cuenta solo a quienes vieron el poll; quien no ha vuelto a la
  // sala desde que se abrió ya no lo bloquea (ADR-0041).
  if (result.outcome === "no_quorum") result = quorumOver(eligible.sawPoll);
  await r.updatePoll(poll.id, { status: "closed", result, closedAt: now });
  await r.insertEvent({
    labId: lab.id,
    kind: "poll.closed",
    actorAgentId: null,
    payload: { poll_id: poll.id, kind: poll.kind, claim_seq: poll.claimSeq, ...result },
    public: true,
  });
  if (result.outcome === "no_quorum") return true;

  if (poll.kind === "adopt_claim") {
    const [claim] = await r.getClaimsBySeq(lab.id, [poll.claimSeq]);
    if (!claim || result.outcome !== "yes") return true;
    const next = claimTransition(claim.status, { kind: "poll_adopted" });
    if (next.status === claim.status) return true; // refutado mientras el poll estaba abierto
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
    await refreshStatus(r, lab, claim.problemId);
    // Si ya tenía las verificaciones que pide la sala, pasa a verde ahora (ADR-0027).
    await maybeVerify(r, lab, rules, { ...claim, status: next.status }, now, null);
    return true;
  }

  const ref = poll.refutationSeq !== null ? await r.getRefutationBySeq(lab.id, poll.refutationSeq) : null;
  if (!ref || ref.status !== "disputed") return true;
  const valid = result.outcome === "yes";
  await settleRefutation(r, lab, ref, valid ? "accepted" : "rejected", valid ? "valid" : "invalid", now, null, "poll");
  return true;
}

export async function pollViews(
  r: Repos,
  labId: string,
  rules: LabRules,
  rows: PollRow[],
  withVotes: boolean,
): Promise<PollView[]> {
  if (!rows.length) return [];
  const details = await r.listClaimDetails(labId, { seqs: [...new Set(rows.map((p) => p.claimSeq))], limit: rows.length });
  const claims = await claimViews(r, details, rules);
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
    if (p.extensions > 0) v.extensions = p.extensions;
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

/** Polls abiertos tal como los ve un agente: sin recuentos y con si su parte puede votar. */
export async function openPollViews(
  r: Repos,
  labId: string,
  rules: LabRules,
  party: string,
  now: Date,
  problemId?: string,
): Promise<OpenPollView[]> {
  const rows = (await r.listPolls(labId, { status: "open", problemId, limit: 20 })).filter((p) => p.closesAt > now);
  const views = await pollViews(r, labId, rules, rows, false);
  const out: OpenPollView[] = [];
  for (const v of views) {
    const row = rows.find((p) => p.id === v.id)!;
    const block = voteBlock(row.caseParties, party, await r.hasVoted(row.id, party));
    out.push(block ? { ...v, you_can_vote: false, cannot_vote_reason: block } : { ...v, you_can_vote: true });
  }
  return out;
}

/** Polls abiertos de toda la sala, primero los del hilo `problemId` (ADR-0030: se vota en cualquiera). */
export async function labPollsFirstHere(
  r: Repos,
  labId: string,
  rules: LabRules,
  party: string,
  now: Date,
  problemId: string,
): Promise<OpenPollView[]> {
  const here = await openPollViews(r, labId, rules, party, now, problemId);
  const all = await openPollViews(r, labId, rules, party, now);
  return [...here, ...all.filter((p) => !here.some((h) => h.id === p.id))];
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
