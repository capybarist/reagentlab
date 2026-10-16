import type {
  ClaimDetail,
  ClaimRow,
  DigestRow,
  EventRow,
  LabRow,
  NewPost,
  PollRow,
  PostRow,
  ProblemRow,
  RefutationRow,
  Repos,
  Store,
  TurnRow,
  CanaryRow,
} from "@reagentlab/core";
import type { CanaryResult, ClaimStatus, Evidence, PollResult, Role } from "@reagentlab/contracts";
import { and, asc, count, desc, eq, gt, gte, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "./connection.js";
import {
  agents,
  claimSupports,
  claims,
  digests,
  events,
  labs,
  memberships,
  polls,
  canaries,
  problems,
  posts,
  reputationEvents,
  verifications,
  forecastResolutions,
  refutations,
  rulings,
  turns,
  users,
  votes,
} from "./schema.js";

type LabSel = typeof labs.$inferSelect;
type TurnSel = typeof turns.$inferSelect;
type DigestSel = typeof digests.$inferSelect;

const toLab = (l: LabSel): LabRow => ({
  id: l.id,
  slug: l.slug,
  title: l.title,
  description: l.description,
  status: l.status,
  rules: l.rules,
  nextSeq: l.nextSeq,
  lifecycle: l.lifecycle,
  section: l.section,
  successorSlug: l.successorSlug,
  proposedByUserId: l.proposedByUserId,
  pendingDomains: (l.pendingDomains as string[] | null) ?? [],
  createdAt: l.createdAt,
  lifecycleChangedAt: l.lifecycleChangedAt,
});

const toTurn = (t: TurnSel): TurnRow => ({ ...t });

const toDigest = (d: DigestSel): DigestRow => ({ ...d });

const toClaim = (c: typeof claims.$inferSelect): ClaimRow => ({ ...c });

const toPoll = (p: typeof polls.$inferSelect): PollRow => ({ ...p, result: (p.result as PollResult | null) ?? null });

const toCanary = (c: typeof canaries.$inferSelect): CanaryRow => ({ ...c, result: (c.result as CanaryResult | null) ?? null });

const toProblem = (p: typeof problems.$inferSelect): ProblemRow => ({ ...p });

const toRefutation = (r: typeof refutations.$inferSelect): RefutationRow => ({ ...r });

const postColumns = {
  post: posts,
  agentName: agents.name,
  modelFamily: agents.modelFamily,
  problemSlug: problems.slug,
};

function toPost(r: {
  post: typeof posts.$inferSelect;
  agentName: string;
  modelFamily: string;
  problemSlug: string | null;
}): PostRow {
  const p = r.post;
  return {
    id: p.id,
    labId: p.labId,
    seq: p.seq,
    problemId: p.problemId,
    problemSlug: r.problemSlug,
    turnId: p.turnId,
    agentId: p.agentId,
    agentName: r.agentName,
    modelFamily: r.modelFamily,
    type: p.type,
    body: p.body,
    refs: p.refs,
    targetSeq: p.targetSeq,
    targetStep: p.targetStep,
    claimKind: p.claimKind,
    stance: p.stance ?? null,
    steps: p.steps as string[],
    evidence: p.evidence as Evidence[],
    confidence: p.confidence,
    predictions: p.predictions as string[],
    falsifiers: p.falsifiers as string[],
    contentHash: p.contentHash,
    prevHash: p.prevHash,
    serverSig: p.serverSig,
    sigKeyId: p.sigKeyId,
    importedFrom: p.importedFrom ?? null,
    artifact: p.artifact ?? null,
    resolvesAt: p.resolvesAt ?? null,
    createdAt: p.createdAt,
  };
}

/** uuid que no existe, para `IN (...)` con lista vacía. */
const NONE = "00000000-0000-0000-0000-000000000000";

function makeRepos(db: Db): Repos {
  const visiblePosts = (labId: string) => and(eq(posts.labId, labId), sql`${posts.hiddenAt} IS NULL`);

  return {
    async listLabs() {
      return (await db.select().from(labs).orderBy(asc(labs.createdAt))).map(toLab);
    },

    async insertLab(lab) {
      const [row] = await db.insert(labs).values(lab).returning();
      return toLab(row!);
    },

    async setLabLifecycle(labId, lifecycle, at) {
      await db.update(labs).set({ lifecycle, lifecycleChangedAt: at }).where(eq(labs.id, labId));
    },

    async countLabsProposedSince(userId, since) {
      const [r] = await db
        .select({ n: count() })
        .from(labs)
        .where(and(eq(labs.proposedByUserId, userId), gte(labs.createdAt, since)));
      return Number(r!.n);
    },

    async countPostingParties(labId, since) {
      // La parte de un agente (ADR-0023/0024): su humano, o el propio agente si ese humano
      // tiene la excepción de agentes independientes.
      const rows = await db.execute<{ n: number }>(sql`
        SELECT count(DISTINCT CASE WHEN u.independent_agents THEN a.id::text ELSE u.id::text END)::int AS n
        FROM ${posts} p JOIN ${agents} a ON a.id = p.agent_id JOIN ${users} u ON u.id = a.user_id
        WHERE p.lab_id = ${labId} AND p.hidden_at IS NULL AND p.created_at >= ${since.toISOString()}`);
      const list = Array.isArray(rows) ? rows : (rows as { rows: { n: number }[] }).rows;
      return Number(list[0]?.n ?? 0);
    },

    async getLabBySlug(slug, opts) {
      const q = db.select().from(labs).where(eq(labs.slug, slug));
      const rows = opts?.forUpdate ? await q.for("update") : await q;
      return rows[0] ? toLab(rows[0]) : null;
    },

    async allocateSeq(labId) {
      const [row] = await db
        .update(labs)
        .set({ nextSeq: sql`${labs.nextSeq} + 1` })
        .where(eq(labs.id, labId))
        .returning({ seq: sql<number>`${labs.nextSeq} - 1` });
      return Number(row!.seq);
    },

    async getActiveTurn(labId, agentId) {
      const [t] = await db
        .select()
        .from(turns)
        .where(and(eq(turns.labId, labId), eq(turns.agentId, agentId), eq(turns.status, "active")));
      return t ? toTurn(t) : null;
    },

    async countActiveTurns(labId, now) {
      const [r] = await db
        .select({ n: count() })
        .from(turns)
        .where(and(eq(turns.labId, labId), eq(turns.status, "active"), gt(turns.leaseExpiresAt, now)));
      return Number(r!.n);
    },

    async countTurnsSince(labId, agentId, since) {
      const [r] = await db
        .select({ n: count() })
        .from(turns)
        .where(and(eq(turns.labId, labId), eq(turns.agentId, agentId), gt(turns.startedAt, since)));
      return Number(r!.n);
    },

    async lastTurnRole(labId, agentId) {
      const [t] = await db
        .select({ role: turns.role })
        .from(turns)
        .where(and(eq(turns.labId, labId), eq(turns.agentId, agentId)))
        .orderBy(desc(turns.startedAt))
        .limit(1);
      return (t?.role as Role | undefined) ?? null;
    },

    async insertCanary(canary) {
      const [c] = await db.insert(canaries).values(canary).returning();
      return toCanary(c!);
    },

    async listCanaries(labId) {
      const rows = await db.select().from(canaries).where(eq(canaries.labId, labId)).orderBy(desc(canaries.armedAt));
      return rows.map(toCanary);
    },

    async listDueCanaries(now) {
      const rows = await db
        .select()
        .from(canaries)
        .where(and(eq(canaries.status, "armed"), lte(canaries.closesAt, now)))
        .orderBy(asc(canaries.closesAt));
      return rows.map(toCanary);
    },

    async updateCanary(id, patch) {
      await db.update(canaries).set(patch).where(eq(canaries.id, id));
    },

    async takeNextRole(agentId) {
      const [a] = await db.select({ role: agents.nextRole }).from(agents).where(eq(agents.id, agentId)).for("update");
      if (!a?.role) return null;
      await db.update(agents).set({ nextRole: null }).where(eq(agents.id, agentId));
      return a.role;
    },

    async lastTurn(labId, agentId) {
      const [t] = await db
        .select()
        .from(turns)
        .where(and(eq(turns.labId, labId), eq(turns.agentId, agentId)))
        .orderBy(desc(turns.startedAt))
        .limit(1);
      return t ? toTurn(t) : null;
    },

    async listActiveTurns(labId, now) {
      const rows = await db
        .select({ turn: turns, agentName: agents.name, modelFamily: agents.modelFamily })
        .from(turns)
        .innerJoin(agents, eq(agents.id, turns.agentId))
        .where(and(eq(turns.labId, labId), eq(turns.status, "active"), gt(turns.leaseExpiresAt, now)))
        .orderBy(asc(turns.startedAt));
      return rows.map((r) => ({ ...toTurn(r.turn), agentName: r.agentName, modelFamily: r.modelFamily }));
    },

    async hasActiveScribe(problemId, now) {
      const [r] = await db
        .select({ n: count() })
        .from(turns)
        .where(
          and(
            eq(turns.problemId, problemId),
            eq(turns.status, "active"),
            eq(turns.role, "scribe"),
            gt(turns.leaseExpiresAt, now),
          ),
        );
      return Number(r!.n) > 0;
    },

    async lastTurnInProblem(problemId, agentId) {
      const [t] = await db
        .select()
        .from(turns)
        .where(and(eq(turns.problemId, problemId), eq(turns.agentId, agentId)))
        .orderBy(desc(turns.startedAt))
        .limit(1);
      return t ? toTurn(t) : null;
    },

    async insertTurn(turn) {
      const [t] = await db.insert(turns).values(turn).returning();
      return toTurn(t!);
    },

    async getTurn(id) {
      const [t] = await db.select().from(turns).where(eq(turns.id, id));
      return t ? toTurn(t) : null;
    },

    async updateTurn(id, patch) {
      await db.update(turns).set(patch).where(eq(turns.id, id));
    },

    async expireTurns(now, labId) {
      const rows = await db
        .update(turns)
        .set({ status: "expired", endedAt: now })
        .where(
          and(
            eq(turns.status, "active"),
            lte(turns.leaseExpiresAt, now),
            labId ? eq(turns.labId, labId) : undefined,
          ),
        )
        .returning();
      return rows.map(toTurn);
    },

    async insertPost(post: NewPost) {
      await db.insert(posts).values(post);
      const [row] = await db
        .select(postColumns)
        .from(posts)
        .innerJoin(agents, eq(agents.id, posts.agentId))
        .leftJoin(problems, eq(problems.id, posts.problemId))
        .where(eq(posts.id, post.id));
      return toPost(row!);
    },

    async lastPost(labId) {
      const [row] = await db
        .select(postColumns)
        .from(posts)
        .innerJoin(agents, eq(agents.id, posts.agentId))
        .leftJoin(problems, eq(problems.id, posts.problemId))
        .where(eq(posts.labId, labId))
        .orderBy(desc(posts.seq))
        .limit(1);
      return row ? toPost(row) : null;
    },

    async listImportedPosts(labId) {
      const rows = await db
        .select({ seq: posts.seq, problemId: posts.problemId, from: posts.importedFrom })
        .from(posts)
        .where(and(eq(posts.labId, labId), sql`${posts.importedFrom} IS NOT NULL`))
        .orderBy(asc(posts.seq));
      return rows.map((r) => ({ fromLabId: r.from!.labId, fromSeq: r.from!.seq, seq: r.seq, problemId: r.problemId }));
    },

    async countOwnProblemPosts(problemId) {
      const [r] = await db
        .select({ n: count() })
        .from(posts)
        .where(and(eq(posts.problemId, problemId), sql`${posts.importedFrom} IS NULL`));
      return Number(r!.n);
    },

    async listPosts(labId, afterSeq, limit, problemId) {
      const rows = await db
        .select(postColumns)
        .from(posts)
        .innerJoin(agents, eq(agents.id, posts.agentId))
        .leftJoin(problems, eq(problems.id, posts.problemId))
        .where(
          and(visiblePosts(labId), gt(posts.seq, afterSeq), problemId ? eq(posts.problemId, problemId) : undefined),
        )
        .orderBy(asc(posts.seq))
        .limit(limit);
      return rows.map(toPost);
    },

    async listRecentProblemPosts(problemId, limit) {
      const rows = await db
        .select(postColumns)
        .from(posts)
        .innerJoin(agents, eq(agents.id, posts.agentId))
        .leftJoin(problems, eq(problems.id, posts.problemId))
        .where(and(eq(posts.problemId, problemId), sql`${posts.hiddenAt} IS NULL`))
        .orderBy(desc(posts.seq))
        .limit(limit);
      return rows.map(toPost).reverse();
    },

    async countProblemPostsAfter(problemId, afterSeq) {
      const [r] = await db
        .select({ n: count() })
        .from(posts)
        .where(and(eq(posts.problemId, problemId), gt(posts.seq, afterSeq), sql`${posts.hiddenAt} IS NULL`));
      return Number(r!.n);
    },

    async listPostSeqsByAgent(labId, agentId) {
      const rows = await db
        .select({ seq: posts.seq })
        .from(posts)
        .where(and(visiblePosts(labId), eq(posts.agentId, agentId)))
        .orderBy(asc(posts.seq));
      return rows.map((r) => r.seq);
    },

    async touchMembership(labId, agentId, now) {
      await db
        .insert(memberships)
        .values({ labId, agentId, joinedAt: now, lastSeenAt: now })
        .onConflictDoUpdate({
          target: [memberships.labId, memberships.agentId],
          set: { lastSeenAt: now, leftAt: null },
        });
    },

    async leaveMembership(labId, agentId, now) {
      await db
        .update(memberships)
        .set({ leftAt: now })
        .where(and(eq(memberships.labId, labId), eq(memberships.agentId, agentId)));
    },

    async countResidents(labId, since) {
      const [r] = await db
        .select({ n: count() })
        .from(memberships)
        .where(and(eq(memberships.labId, labId), sql`${memberships.leftAt} IS NULL`, gt(memberships.lastSeenAt, since)));
      return Number(r!.n);
    },

    async listResidentsLastTurn(labId, since) {
      const rows = await db
        .select({ agentId: memberships.agentId, lastTurnAt: sql<Date | string | null>`max(${turns.startedAt})` })
        .from(memberships)
        .leftJoin(turns, and(eq(turns.labId, memberships.labId), eq(turns.agentId, memberships.agentId)))
        .where(and(eq(memberships.labId, labId), sql`${memberships.leftAt} IS NULL`, gt(memberships.lastSeenAt, since)))
        .groupBy(memberships.agentId);
      return rows.map((r) => ({ agentId: r.agentId, lastTurnAt: r.lastTurnAt ? new Date(r.lastTurnAt) : null }));
    },

    async getPostsBySeq(labId, seqs) {
      if (!seqs.length) return [];
      const rows = await db
        .select(postColumns)
        .from(posts)
        .innerJoin(agents, eq(agents.id, posts.agentId))
        .leftJoin(problems, eq(problems.id, posts.problemId))
        .where(and(visiblePosts(labId), inArray(posts.seq, seqs)));
      return rows.map(toPost);
    },

    async countPostsInTurn(turnId) {
      const [r] = await db.select({ n: count() }).from(posts).where(eq(posts.turnId, turnId));
      return Number(r!.n);
    },

    async countPosts(labId) {
      const [r] = await db.select({ n: count() }).from(posts).where(visiblePosts(labId));
      return Number(r!.n);
    },

    async getAgent(agentId) {
      const [a] = await db
        .select({
          agentId: agents.id,
          userId: agents.userId,
          name: agents.name,
          modelFamily: agents.modelFamily,
          independentAgents: users.independentAgents,
        })
        .from(agents)
        .innerJoin(users, eq(users.id, agents.userId))
        .where(eq(agents.id, agentId));
      return a ?? null;
    },

    async insertClaim(claim) {
      const [c] = await db.insert(claims).values(claim).returning();
      return toClaim(c!);
    },

    async getClaimsBySeq(labId, seqs) {
      if (!seqs.length) return [];
      const rows = await db
        .select()
        .from(claims)
        .where(and(eq(claims.labId, labId), inArray(claims.originSeq, seqs)));
      return rows.map(toClaim);
    },

    async updateClaim(id, patch) {
      await db.update(claims).set(patch).where(eq(claims.id, id));
    },

    async listClaimDetails(labId, opts) {
      const rows = await db
        .select({
          claim: claims,
          authorName: agents.name,
          authorFamily: agents.modelFamily,
          body: posts.body,
          steps: posts.steps,
          hasArtifact: sql<boolean>`${posts.artifact} IS NOT NULL`,
        })
        .from(claims)
        .innerJoin(posts, eq(posts.id, claims.originPostId))
        .innerJoin(agents, eq(agents.id, claims.authorAgentId))
        .where(
          and(
            eq(claims.labId, labId),
            sql`${posts.hiddenAt} IS NULL`,
            opts.statuses?.length ? inArray(claims.status, opts.statuses as ClaimStatus[]) : undefined,
            opts.seqs ? inArray(claims.originSeq, opts.seqs.length ? opts.seqs : [-1]) : undefined,
            opts.problemId ? eq(claims.problemId, opts.problemId) : undefined,
          ),
        )
        .orderBy(desc(claims.originSeq))
        .limit(opts.limit);
      return rows.map(
        (r): ClaimDetail => ({
          ...toClaim(r.claim),
          authorName: r.authorName,
          authorFamily: r.authorFamily,
          body: r.body,
          steps: r.steps as string[],
          hasArtifact: !!r.hasArtifact,
        }),
      );
    },

    async addClaimSupport(support) {
      const rows = await db.insert(claimSupports).values(support).onConflictDoNothing().returning();
      return rows.length > 0;
    },

    async listClaimSupportParties(claimId) {
      const rows = await db.select({ party: claimSupports.party }).from(claimSupports).where(eq(claimSupports.claimId, claimId));
      return rows.map((r) => r.party);
    },

    async insertRefutation(ref) {
      const [r] = await db.insert(refutations).values(ref).returning();
      return toRefutation(r!);
    },

    async getRefutationBySeq(labId, postSeq) {
      const [r] = await db
        .select()
        .from(refutations)
        .where(and(eq(refutations.labId, labId), eq(refutations.postSeq, postSeq)));
      return r ? toRefutation(r) : null;
    },

    async updateRefutation(id, patch) {
      await db.update(refutations).set(patch).where(eq(refutations.id, id));
    },

    async listRefutations(labId, statuses) {
      const rows = await db
        .select()
        .from(refutations)
        .where(and(eq(refutations.labId, labId), inArray(refutations.status, statuses)))
        .orderBy(asc(refutations.postSeq));
      return rows.map(toRefutation);
    },

    async listRefutationsForClaims(claimIds) {
      if (!claimIds.length) return [];
      const rows = await db
        .select()
        .from(refutations)
        .where(inArray(refutations.claimId, claimIds))
        .orderBy(asc(refutations.postSeq));
      return rows.map(toRefutation);
    },

    async insertRuling(ruling) {
      const [r] = await db.insert(rulings).values(ruling).returning();
      return { ...r! };
    },

    async listRulingUsers(refutationId) {
      const rows = await db.select({ userId: rulings.userId }).from(rulings).where(eq(rulings.refutationId, refutationId));
      return rows.map((r) => r.userId);
    },

    async listRulingParties(refutationId) {
      const rows = await db.select({ party: rulings.party }).from(rulings).where(eq(rulings.refutationId, refutationId));
      return rows.map((r) => r.party);
    },

    async listRuledInTurn(turnId) {
      const rows = await db.select({ id: rulings.refutationId }).from(rulings).where(eq(rulings.turnId, turnId));
      return rows.map((r) => r.id);
    },

    async insertVerification(v) {
      const rows = await db.insert(verifications).values(v).onConflictDoNothing().returning({ id: verifications.id });
      return rows.length > 0;
    },

    async listVerificationsForClaims(claimIds) {
      if (!claimIds.length) return [];
      const rows = await db
        .select({ v: verifications, agentName: agents.name, modelFamily: agents.modelFamily })
        .from(verifications)
        .innerJoin(agents, eq(agents.id, verifications.agentId))
        .where(inArray(verifications.claimId, claimIds))
        .orderBy(asc(verifications.createdAt));
      return rows.map((r) => ({ ...r.v, agentName: r.agentName, modelFamily: r.modelFamily }));
    },

    async insertForecastResolution(v) {
      const rows = await db
        .insert(forecastResolutions)
        .values(v)
        .onConflictDoNothing()
        .returning({ id: forecastResolutions.id });
      return rows.length > 0;
    },

    async listForecastResolutionsForClaims(claimIds) {
      if (!claimIds.length) return [];
      const rows = await db
        .select({ v: forecastResolutions, agentName: agents.name, modelFamily: agents.modelFamily })
        .from(forecastResolutions)
        .innerJoin(agents, eq(agents.id, forecastResolutions.agentId))
        .where(inArray(forecastResolutions.claimId, claimIds))
        .orderBy(asc(forecastResolutions.createdAt));
      return rows.map((r) => ({ ...r.v, agentName: r.agentName, modelFamily: r.modelFamily }));
    },

    async listDueForecastSeqs(labId, now, problemId) {
      const rows = await db
        .select({ seq: claims.originSeq })
        .from(claims)
        .innerJoin(posts, eq(posts.id, claims.originPostId))
        .where(
          and(
            eq(claims.labId, labId),
            sql`${posts.hiddenAt} IS NULL`,
            sql`${claims.resolution} IS NULL`,
            lte(claims.resolvesAt, now),
            problemId ? eq(claims.problemId, problemId) : undefined,
          ),
        )
        .orderBy(asc(claims.resolvesAt));
      return rows.map((r) => r.seq);
    },

    async claimStatusCounts(problemId) {
      const rows = await db
        .select({ status: claims.status, n: count() })
        .from(claims)
        .where(eq(claims.problemId, problemId))
        .groupBy(claims.status);
      return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
    },

    async getLabStatus(labId) {
      const [l] = await db.select({ status: labs.status }).from(labs).where(eq(labs.id, labId));
      return l?.status ?? null;
    },

    async updateLabStatus(labId, status) {
      await db.update(labs).set({ status }).where(eq(labs.id, labId));
    },

    async getUserReputation(userId) {
      const [u] = await db.select({ reputation: users.reputation }).from(users).where(eq(users.id, userId));
      return u?.reputation ?? 0;
    },

    async addReputation(event) {
      const rows = await db.insert(reputationEvents).values(event).onConflictDoNothing().returning({ id: reputationEvents.id });
      if (!rows.length) return false;
      await db
        .update(users)
        .set({ reputation: sql`${users.reputation} + ${event.delta}` })
        .where(eq(users.id, event.userId));
      return true;
    },

    async insertPoll(poll) {
      const [p] = await db.insert(polls).values(poll).returning();
      return toPoll(p!);
    },

    async getPoll(id) {
      const [p] = await db.select().from(polls).where(eq(polls.id, id));
      return p ? toPoll(p) : null;
    },

    async listPolls(labId, opts) {
      const rows = await db
        .select()
        .from(polls)
        .where(
          and(
            eq(polls.labId, labId),
            opts.status ? eq(polls.status, opts.status) : undefined,
            opts.claimIds ? inArray(polls.claimId, opts.claimIds.length ? opts.claimIds : [NONE]) : undefined,
            opts.refutationIds
              ? inArray(polls.refutationId, opts.refutationIds.length ? opts.refutationIds : [NONE])
              : undefined,
            opts.problemId ? eq(polls.problemId, opts.problemId) : undefined,
          ),
        )
        .orderBy(desc(polls.opensAt), desc(polls.id))
        .limit(opts.limit);
      return rows.map(toPoll);
    },

    async listDuePolls(now) {
      const rows = await db
        .select()
        .from(polls)
        .where(and(eq(polls.status, "open"), lte(polls.closesAt, now)))
        .orderBy(asc(polls.closesAt));
      return rows.map(toPoll);
    },

    async updatePoll(id, patch) {
      await db.update(polls).set(patch).where(eq(polls.id, id));
    },

    async listRecentLabAgents(labId, since) {
      return db
        .selectDistinct({
          agentId: agents.id,
          userId: agents.userId,
          modelFamily: agents.modelFamily,
          independentAgents: users.independentAgents,
        })
        .from(turns)
        .innerJoin(agents, eq(agents.id, turns.agentId))
        .innerJoin(users, eq(users.id, agents.userId))
        .where(
          and(eq(turns.labId, labId), gt(turns.startedAt, since), eq(agents.status, "active"), sql`${users.bannedAt} IS NULL`),
        );
    },

    async insertVote(vote) {
      const rows = await db.insert(votes).values(vote).onConflictDoNothing().returning({ id: votes.id });
      return rows.length > 0;
    },

    async hasVoted(pollId, party) {
      const [r] = await db
        .select({ n: count() })
        .from(votes)
        .where(and(eq(votes.pollId, pollId), eq(votes.party, party)));
      return Number(r!.n) > 0;
    },

    async listClosedPollVotes(pollId) {
      // El filtro por estado va en la consulta: un poll abierto nunca devuelve votos.
      const rows = await db
        .select({ vote: votes, agentName: agents.name })
        .from(votes)
        .innerJoin(polls, eq(polls.id, votes.pollId))
        .innerJoin(agents, eq(agents.id, votes.agentId))
        .where(and(eq(votes.pollId, pollId), eq(polls.status, "closed")))
        .orderBy(asc(votes.createdAt));
      return rows.map((r) => ({ ...r.vote, agentName: r.agentName }));
    },

    async listVotesForTally(pollId) {
      return db.select().from(votes).where(eq(votes.pollId, pollId));
    },

    async latestDigest(labId, problemId) {
      const [d] = await db
        .select()
        .from(digests)
        .where(
          and(eq(digests.labId, labId), problemId ? eq(digests.problemId, problemId) : sql`${digests.problemId} IS NULL`),
        )
        .orderBy(desc(digests.version))
        .limit(1);
      return d ? toDigest(d) : null;
    },

    async insertDigest(digest) {
      const [d] = await db.insert(digests).values(digest).returning();
      return toDigest(d!);
    },

    async getProblem(labId, slug) {
      const [p] = await db.select().from(problems).where(and(eq(problems.labId, labId), eq(problems.slug, slug)));
      return p ? toProblem(p) : null;
    },

    async getProblemById(id) {
      const [p] = await db.select().from(problems).where(eq(problems.id, id));
      return p ? toProblem(p) : null;
    },

    async listProblems(labId, reviews) {
      const rows = await db
        .select()
        .from(problems)
        .where(and(eq(problems.labId, labId), reviews?.length ? inArray(problems.review, reviews) : undefined))
        .orderBy(asc(problems.createdAt), asc(problems.slug));
      return rows.map(toProblem);
    },

    async insertProblem(problem) {
      const [p] = await db.insert(problems).values(problem).returning();
      return toProblem(p!);
    },

    async updateProblem(id, patch) {
      await db.update(problems).set(patch).where(eq(problems.id, id));
    },

    async countPendingProposals(userId) {
      const [r] = await db
        .select({ n: count() })
        .from(problems)
        .where(and(eq(problems.proposedByUserId, userId), eq(problems.review, "proposed")));
      return Number(r!.n);
    },

    async countProblemsProposedSince(by, since) {
      const [r] = await db
        .select({ n: count() })
        .from(problems)
        .where(
          and(
            gte(problems.createdAt, since),
            by.agentId ? eq(problems.proposedByAgentId, by.agentId) : undefined,
            by.userId ? eq(problems.proposedByUserId, by.userId) : undefined,
          ),
        );
      return Number(r!.n);
    },

    async problemStats(labId) {
      const rows = await db.execute<{
        problem_id: string;
        post_count: number;
        open_claims: number;
        last_post_at: Date | string | null;
        last_turn_at: Date | string | null;
        digest_version: number | null;
        digest_at: Date | string | null;
        posts_since_digest: number;
      }>(sql`
        SELECT pr.id AS problem_id,
          (SELECT count(*)::int FROM ${posts} p WHERE p.problem_id = pr.id AND p.hidden_at IS NULL) AS post_count,
          (SELECT count(*)::int FROM ${claims} c WHERE c.problem_id = pr.id AND c.status <> 'refuted') AS open_claims,
          (SELECT max(p.created_at) FROM ${posts} p WHERE p.problem_id = pr.id AND p.hidden_at IS NULL) AS last_post_at,
          (SELECT max(t.started_at) FROM ${turns} t WHERE t.problem_id = pr.id) AS last_turn_at,
          d.version AS digest_version,
          d.created_at AS digest_at,
          (SELECT count(*)::int FROM ${posts} p
            WHERE p.problem_id = pr.id AND p.hidden_at IS NULL AND p.seq > coalesce(d.based_on_seq, 0)) AS posts_since_digest
        FROM ${problems} pr
        LEFT JOIN LATERAL (
          SELECT dg.version, dg.created_at, dg.based_on_seq FROM ${digests} dg
          WHERE dg.problem_id = pr.id ORDER BY dg.version DESC LIMIT 1
        ) d ON true
        WHERE pr.lab_id = ${labId}`);
      const list = Array.isArray(rows) ? rows : (rows as { rows: unknown[] }).rows;
      return (list as {
        problem_id: string;
        post_count: number;
        open_claims: number;
        last_post_at: Date | string | null;
        last_turn_at: Date | string | null;
        digest_version: number | null;
        digest_at: Date | string | null;
        posts_since_digest: number;
      }[]).map((r) => ({
        problemId: r.problem_id,
        postCount: Number(r.post_count),
        openClaims: Number(r.open_claims),
        lastActivityAt: r.last_post_at ? new Date(r.last_post_at) : null,
        lastTurnAt: r.last_turn_at ? new Date(r.last_turn_at) : null,
        digestVersion: r.digest_version === null ? null : Number(r.digest_version),
        digestAt: r.digest_at ? new Date(r.digest_at) : null,
        postsSinceDigest: Number(r.posts_since_digest),
      }));
    },

    async getUserHandle(userId) {
      const [u] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, userId));
      return u?.handle ?? null;
    },

    async insertEvent(event) {
      await db.insert(events).values(event);
    },

    async listPublicEvents(labId, afterId, limit) {
      const rows = await db
        .select()
        .from(events)
        .where(and(eq(events.labId, labId), eq(events.public, true), gt(events.id, afterId)))
        .orderBy(asc(events.id))
        .limit(limit);
      return rows as EventRow[];
    },

    async latestPublicEventId(labId) {
      const [r] = await db
        .select({ id: sql<number | null>`max(${events.id})` })
        .from(events)
        .where(and(eq(events.labId, labId), eq(events.public, true)));
      return Number(r?.id ?? 0);
    },

    async siteStats(activeSince) {
      // Agentes de humanos baneados no cuentan; los posts y claims importados (ADR-0026) son copias.
      const res = await db.execute<Record<string, number>>(sql`
        WITH live AS (
          SELECT a.id, a.user_id, a.model_family FROM ${agents} a JOIN ${users} u ON u.id = a.user_id
          WHERE a.status = 'active' AND u.banned_at IS NULL
        ),
        recent AS (
          SELECT DISTINCT t.agent_id FROM ${turns} t WHERE t.started_at >= ${activeSince.toISOString()}
        ),
        original_posts AS (
          SELECT id FROM ${posts} WHERE hidden_at IS NULL AND imported_from IS NULL
        )
        SELECT
          (SELECT count(*) FROM live l JOIN recent r ON r.agent_id = l.id)::int AS agents_active_24h,
          (SELECT count(DISTINCT l.user_id) FROM live l JOIN recent r ON r.agent_id = l.id)::int AS humans_active_24h,
          (SELECT count(*) FROM live)::int AS agents_registered,
          (SELECT count(DISTINCT user_id) FROM live)::int AS humans_registered,
          (SELECT count(DISTINCT model_family) FROM live)::int AS model_families,
          (SELECT count(*) FROM original_posts)::int AS posts,
          (SELECT count(*) FROM ${claims} c JOIN original_posts p ON p.id = c.origin_post_id)::int AS claims,
          (SELECT count(*) FROM ${claims} c JOIN original_posts p ON p.id = c.origin_post_id
            WHERE c.status IN ('adopted', 'verified'))::int AS claims_adopted,
          (SELECT count(*) FROM ${verifications})::int AS verifications`);
      const list = Array.isArray(res) ? res : (res as { rows: Record<string, number>[] }).rows;
      const row = list[0] ?? {};
      const n = (k: string) => Number(row[k] ?? 0);
      return {
        agents_active_24h: n("agents_active_24h"),
        humans_active_24h: n("humans_active_24h"),
        agents_registered: n("agents_registered"),
        humans_registered: n("humans_registered"),
        model_families: n("model_families"),
        posts: n("posts"),
        claims: n("claims"),
        claims_adopted: n("claims_adopted"),
        verifications: n("verifications"),
      };
    },

    async leaderboard() {
      // Mismo criterio que siteStats: ni copias importadas ni posts ocultos, ni humanos baneados.
      const rowsOf = <T>(res: unknown) => (Array.isArray(res) ? res : (res as { rows: T[] }).rows) as T[];
      const base = sql`
        fam AS (
          SELECT a.id AS agent_id, a.user_id, a.status, lower(btrim(a.model_family)) AS family
          FROM ${agents} a JOIN ${users} u ON u.id = a.user_id
          WHERE u.banned_at IS NULL AND a.status <> 'banned'
        ),
        op AS (SELECT id, agent_id FROM ${posts} WHERE hidden_at IS NULL AND imported_from IS NULL),
        cl AS (SELECT c.author_agent_id AS agent_id, c.status FROM ${claims} c JOIN op ON op.id = c.origin_post_id),
        rf AS (
          SELECT r.id, r.refuter_agent_id AS agent_id, r.status, c.author_agent_id
          FROM ${refutations} r JOIN op ON op.id = r.post_id JOIN ${claims} c ON c.id = r.claim_id
        )`;
      const families = rowsOf<Record<string, string | number>>(
        await db.execute(sql`
          WITH ${base},
          people AS (
            SELECT family, count(*) FILTER (WHERE status = 'active') AS agents, count(DISTINCT user_id) AS people
            FROM fam GROUP BY family
          ),
          p AS (SELECT g.family, count(*) AS n FROM op JOIN fam g ON g.agent_id = op.agent_id GROUP BY g.family),
          c AS (
            SELECT g.family, count(*) AS n,
              count(*) FILTER (WHERE cl.status IN ('adopted', 'verified')) AS adopted,
              count(*) FILTER (WHERE cl.status = 'verified') AS verified,
              count(*) FILTER (WHERE cl.status = 'refuted') AS refuted
            FROM cl JOIN fam g ON g.agent_id = cl.agent_id GROUP BY g.family
          ),
          r AS (
            SELECT g.family, count(*) AS n,
              count(*) FILTER (WHERE rf.status = 'accepted') AS accepted,
              count(*) FILTER (WHERE rf.status = 'rejected') AS rejected
            FROM rf JOIN fam g ON g.agent_id = rf.agent_id GROUP BY g.family
          ),
          ru AS (
            SELECT g.family, count(*) AS n,
              count(*) FILTER (WHERE (rf.status = 'accepted' AND x.verdict = 'valid')
                OR (rf.status = 'rejected' AND x.verdict = 'invalid')) AS upheld
            FROM ${rulings} x JOIN rf ON rf.id = x.refutation_id JOIN fam g ON g.agent_id = x.agent_id GROUP BY g.family
          ),
          v AS (SELECT g.family, count(*) AS n FROM ${verifications} x JOIN fam g ON g.agent_id = x.agent_id GROUP BY g.family),
          fc AS (
            SELECT g.family, count(*) AS n,
              avg(power(x.probability - CASE WHEN x.resolution = 'yes' THEN 1 ELSE 0 END, 2)) AS brier
            FROM ${claims} x JOIN op ON op.id = x.origin_post_id JOIN fam g ON g.agent_id = x.author_agent_id
            WHERE x.resolution IN ('yes', 'no') AND x.probability IS NOT NULL GROUP BY g.family
          )
          SELECT people.family, people.agents, people.people,
            coalesce(p.n, 0) AS posts, coalesce(c.n, 0) AS claims, coalesce(c.adopted, 0) AS claims_adopted,
            coalesce(c.verified, 0) AS claims_verified, coalesce(c.refuted, 0) AS claims_refuted,
            coalesce(r.n, 0) AS refutations, coalesce(r.accepted, 0) AS refutations_accepted,
            coalesce(r.rejected, 0) AS refutations_rejected, coalesce(ru.n, 0) AS rulings,
            coalesce(ru.upheld, 0) AS rulings_upheld, coalesce(v.n, 0) AS verifications,
            coalesce(fc.n, 0) AS forecasts_resolved, fc.brier
          FROM people
          LEFT JOIN p ON p.family = people.family LEFT JOIN c ON c.family = people.family
          LEFT JOIN r ON r.family = people.family LEFT JOIN ru ON ru.family = people.family
          LEFT JOIN v ON v.family = people.family LEFT JOIN fc ON fc.family = people.family
          WHERE people.agents > 0 OR p.n > 0`),
      );
      const matrix = rowsOf<Record<string, string | number>>(
        await db.execute(sql`
          WITH ${base}
          SELECT gr.family AS refuter_family, ga.family AS author_family, count(*) AS refutations,
            count(*) FILTER (WHERE rf.status = 'accepted') AS accepted
          FROM rf JOIN fam gr ON gr.agent_id = rf.agent_id JOIN fam ga ON ga.agent_id = rf.author_agent_id
          GROUP BY gr.family, ga.family`),
      );
      const n = (row: Record<string, string | number>, k: string) => Number(row[k] ?? 0);
      const stats = families.map((row) => ({
        model_family: String(row.family),
        agents: n(row, "agents"),
        people: n(row, "people"),
        posts: n(row, "posts"),
        claims: n(row, "claims"),
        claims_adopted: n(row, "claims_adopted"),
        claims_verified: n(row, "claims_verified"),
        claims_refuted: n(row, "claims_refuted"),
        refutations: n(row, "refutations"),
        refutations_accepted: n(row, "refutations_accepted"),
        refutations_rejected: n(row, "refutations_rejected"),
        rulings: n(row, "rulings"),
        rulings_upheld: n(row, "rulings_upheld"),
        verifications: n(row, "verifications"),
        forecasts_resolved: n(row, "forecasts_resolved"),
        brier: row.brier === null || row.brier === undefined ? null : Number(row.brier),
      }));
      // Primero lo que ha resistido: verificados, adoptados, refutaciones aceptadas; luego actividad.
      stats.sort(
        (a, b) =>
          b.claims_verified - a.claims_verified ||
          b.claims_adopted - a.claims_adopted ||
          b.refutations_accepted - a.refutations_accepted ||
          b.posts - a.posts ||
          a.model_family.localeCompare(b.model_family),
      );
      return {
        families: stats,
        refutations: matrix
          .map((row) => ({
            refuter_family: String(row.refuter_family),
            author_family: String(row.author_family),
            refutations: n(row, "refutations"),
            accepted: n(row, "accepted"),
          }))
          .sort((a, b) => b.refutations - a.refutations || a.refuter_family.localeCompare(b.refuter_family)),
      };
    },
  };
}

/** Implementación de `Store` (puerto de core) sobre Drizzle. */
export function createStore(db: Db): Store {
  return {
    transaction: (fn) => db.transaction((tx) => fn(makeRepos(tx as unknown as Db))),
    read: (fn) => fn(makeRepos(db)),
  };
}
