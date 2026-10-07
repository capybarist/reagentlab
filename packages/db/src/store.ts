import type {
  DigestRow,
  EventRow,
  LabRow,
  NewPost,
  PostRow,
  Repos,
  Store,
  TurnRow,
} from "@reagentlab/core";
import type { Evidence, Role } from "@reagentlab/contracts";
import { and, asc, count, desc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "./connection.js";
import { agents, digests, events, labs, memberships, posts, turns } from "./schema.js";

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

const postColumns = {
  post: posts,
  agentName: agents.name,
  modelFamily: agents.modelFamily,
};

function toPost(r: { post: typeof posts.$inferSelect; agentName: string; modelFamily: string }): PostRow {
  const p = r.post;
  return {
    id: p.id,
    labId: p.labId,
    seq: p.seq,
    turnId: p.turnId,
    agentId: p.agentId,
    agentName: r.agentName,
    modelFamily: r.modelFamily,
    type: p.type,
    body: p.body,
    refs: p.refs,
    targetSeq: p.targetSeq,
    evidence: p.evidence as Evidence[],
    confidence: p.confidence,
    predictions: p.predictions as string[],
    falsifiers: p.falsifiers as string[],
    contentHash: p.contentHash,
    prevHash: p.prevHash,
    createdAt: p.createdAt,
  };
}

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

    async hasActiveScribe(labId, now) {
      const [r] = await db
        .select({ n: count() })
        .from(turns)
        .where(
          and(
            eq(turns.labId, labId),
            eq(turns.status, "active"),
            eq(turns.role, "scribe"),
            gt(turns.leaseExpiresAt, now),
          ),
        );
      return Number(r!.n) > 0;
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
        .where(eq(posts.id, post.id));
      return toPost(row!);
    },

    async lastPost(labId) {
      const [row] = await db
        .select(postColumns)
        .from(posts)
        .innerJoin(agents, eq(agents.id, posts.agentId))
        .where(eq(posts.labId, labId))
        .orderBy(desc(posts.seq))
        .limit(1);
      return row ? toPost(row) : null;
    },

    async listPosts(labId, afterSeq, limit) {
      const rows = await db
        .select(postColumns)
        .from(posts)
        .innerJoin(agents, eq(agents.id, posts.agentId))
        .where(and(visiblePosts(labId), gt(posts.seq, afterSeq)))
        .orderBy(asc(posts.seq))
        .limit(limit);
      return rows.map(toPost);
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

    async latestDigest(labId) {
      const [d] = await db
        .select()
        .from(digests)
        .where(eq(digests.labId, labId))
        .orderBy(desc(digests.version))
        .limit(1);
      return d ? toDigest(d) : null;
    },

    async insertDigest(digest) {
      const [d] = await db.insert(digests).values(digest).returning();
      return toDigest(d!);
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
