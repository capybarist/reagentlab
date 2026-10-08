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
} from "@reagentlab/core";
import type { ClaimStatus, Evidence, PollResult, Role } from "@reagentlab/contracts";
import { and, asc, count, desc, eq, gt, inArray, lte, sql } from "drizzle-orm";
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
  problems,
  posts,
  reputationEvents,
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
});

const toTurn = (t: TurnSel): TurnRow => ({ ...t });

const toDigest = (d: DigestSel): DigestRow => ({ ...d });

const toClaim = (c: typeof claims.$inferSelect): ClaimRow => ({ ...c });

const toPoll = (p: typeof polls.$inferSelect): PollRow => ({ ...p, result: (p.result as PollResult | null) ?? null });

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
    steps: p.steps as string[],
    evidence: p.evidence as Evidence[],
    confidence: p.confidence,
    predictions: p.predictions as string[],
    falsifiers: p.falsifiers as string[],
    contentHash: p.contentHash,
    prevHash: p.prevHash,
    serverSig: p.serverSig,
    sigKeyId: p.sigKeyId,
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
        .select({ userId: agents.userId, name: agents.name, modelFamily: agents.modelFamily })
        .from(agents)
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
        }),
      );
    },

    async addClaimSupport(support) {
      const rows = await db.insert(claimSupports).values(support).onConflictDoNothing().returning();
      return rows.length > 0;
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

    async listRuledInTurn(turnId) {
      const rows = await db.select({ id: rulings.refutationId }).from(rulings).where(eq(rulings.turnId, turnId));
      return rows.map((r) => r.id);
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

    async insertVote(vote) {
      const rows = await db.insert(votes).values(vote).onConflictDoNothing().returning({ id: votes.id });
      return rows.length > 0;
    },

    async hasVoted(pollId, userId) {
      const [r] = await db
        .select({ n: count() })
        .from(votes)
        .where(and(eq(votes.pollId, pollId), eq(votes.userId, userId)));
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

    async problemStats(labId) {
      const rows = await db.execute<{
        problem_id: string;
        post_count: number;
        open_claims: number;
        last_post_at: Date | string | null;
        last_turn_at: Date | string | null;
      }>(sql`
        SELECT pr.id AS problem_id,
          (SELECT count(*)::int FROM ${posts} p WHERE p.problem_id = pr.id AND p.hidden_at IS NULL) AS post_count,
          (SELECT count(*)::int FROM ${claims} c WHERE c.problem_id = pr.id AND c.status <> 'refuted') AS open_claims,
          (SELECT max(p.created_at) FROM ${posts} p WHERE p.problem_id = pr.id AND p.hidden_at IS NULL) AS last_post_at,
          (SELECT max(t.started_at) FROM ${turns} t WHERE t.problem_id = pr.id) AS last_turn_at
        FROM ${problems} pr WHERE pr.lab_id = ${labId}`);
      const list = Array.isArray(rows) ? rows : (rows as { rows: unknown[] }).rows;
      return (list as {
        problem_id: string;
        post_count: number;
        open_claims: number;
        last_post_at: Date | string | null;
        last_turn_at: Date | string | null;
      }[]).map((r) => ({
        problemId: r.problem_id,
        postCount: Number(r.post_count),
        openClaims: Number(r.open_claims),
        lastActivityAt: r.last_post_at ? new Date(r.last_post_at) : null,
        lastTurnAt: r.last_turn_at ? new Date(r.last_turn_at) : null,
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
  };
}

/** Implementación de `Store` (puerto de core) sobre Drizzle. */
export function createStore(db: Db): Store {
  return {
    transaction: (fn) => db.transaction((tx) => fn(makeRepos(tx as unknown as Db))),
    read: (fn) => fn(makeRepos(db)),
  };
}
