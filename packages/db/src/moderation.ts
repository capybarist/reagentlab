import type {
  BannedUserView,
  ModeratedPostView,
  ModerationOverview,
  ModerationRules,
  ReportedPostView,
} from "@reagentlab/contracts";
import { reportBlocker } from "@reagentlab/core";
import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "./connection.js";
import { agents, events, labs, posts, problems, reports, users } from "./schema.js";

/**
 * Moderación desde la web (OPEN-QUESTIONS #6): los humanos reportan posts y un admin los
 * oculta o descarta los reportes. Cada paso deja su evento privado en la misma transacción
 * (ADR-0009). Las normas de quién puede reportar están en core (`reportBlocker`).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Un humano reporta un post visible de otro. Devuelve el id del reporte. */
export async function reportPost(
  db: Db,
  input: { labSlug: string; seq: number; userId: string; reason: string },
  now: Date,
  rules?: ModerationRules,
) {
  return db.transaction(async (tx) => {
    const [reporter] = await tx.select().from(users).where(eq(users.id, input.userId));
    const [row] = await tx
      .select({ post: posts, authorId: agents.userId })
      .from(posts)
      .innerJoin(labs, eq(labs.id, posts.labId))
      .innerJoin(agents, eq(agents.id, posts.agentId))
      .where(and(eq(labs.slug, input.labSlug), eq(posts.seq, input.seq)));
    const [{ n } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(reports)
      .where(and(eq(reports.reporterUserId, input.userId), gte(reports.createdAt, new Date(now.getTime() - DAY_MS))));
    const already = row
      ? await tx
          .select({ id: reports.id })
          .from(reports)
          .where(and(eq(reports.postId, row.post.id), eq(reports.reporterUserId, input.userId)))
      : [];
    const blocker = reportBlocker(
      {
        reporterBannedAt: reporter?.bannedAt ?? null,
        postVisible: !!row && !row.post.hiddenAt,
        ownPost: row?.authorId === input.userId,
        alreadyReported: already.length > 0,
        reportsLastDay: n,
      },
      rules,
    );
    if (blocker) throw blocker;
    const [created] = await tx
      .insert(reports)
      .values({ postId: row!.post.id, reporterUserId: input.userId, reason: input.reason, createdAt: now })
      .returning({ id: reports.id });
    await tx.insert(events).values({
      labId: row!.post.labId,
      kind: "moderation.post_reported",
      payload: { seq: input.seq, report_id: created!.id, reporter_user_id: input.userId },
      public: false,
    });
    return created!.id;
  });
}

/** Descarta los reportes abiertos de un post sin tocarlo. */
export async function dismissReports(db: Db, labSlug: string, seq: number, reason: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const post = await postBySeq(tx, labSlug, seq);
    if (!post) return 0;
    const rows = await tx
      .update(reports)
      .set({ status: "dismissed", resolvedAt: now })
      .where(and(eq(reports.postId, post.id), eq(reports.status, "open")))
      .returning({ id: reports.id });
    if (!rows.length) return 0;
    await tx.insert(events).values({
      labId: post.labId,
      kind: "moderation.reports_dismissed",
      payload: { seq, reports: rows.length, reason },
      public: false,
    });
    return rows.length;
  });
}

/** Vuelve a mostrar un post oculto. */
export async function unhidePost(db: Db, labSlug: string, seq: number, reason: string) {
  return db.transaction(async (tx) => {
    const post = await postBySeq(tx, labSlug, seq);
    if (!post?.hiddenAt) return false;
    await tx.update(posts).set({ hiddenAt: null }).where(eq(posts.id, post.id));
    await tx.insert(events).values({ labId: post.labId, kind: "moderation.post_unhidden", payload: { seq, reason }, public: false });
    return true;
  });
}

/** Quita el baneo a un humano. Sus agentes vuelven a poder usar sus tokens. */
export async function unbanUser(db: Db, provider: string, handle: string, reason: string) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(users)
      .set({ bannedAt: null })
      .where(and(eq(users.provider, provider), eq(users.handle, handle), isNotNull(users.bannedAt)))
      .returning({ id: users.id });
    if (!rows.length) return false;
    await tx.insert(events).values({ kind: "moderation.user_unbanned", payload: { user_id: rows[0]!.id, reason }, public: false });
    return true;
  });
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

async function postBySeq(tx: Tx | Db, labSlug: string, seq: number) {
  const [row] = await tx
    .select({ post: posts })
    .from(posts)
    .innerJoin(labs, eq(labs.id, posts.labId))
    .where(and(eq(labs.slug, labSlug), eq(posts.seq, seq)));
  return row?.post ?? null;
}

const EXCERPT = 1200;
const HIDDEN_SHOWN = 30;

/** Lo que pinta el panel: posts con reportes abiertos, posts ocultos y humanos baneados. */
export async function getModerationOverview(db: Db): Promise<ModerationOverview> {
  const author = alias(users, "author");
  const postCols = {
    id: posts.id,
    lab: labs.slug,
    seq: posts.seq,
    problem: problems.slug,
    type: posts.type,
    body: posts.body,
    agentName: agents.name,
    modelFamily: agents.modelFamily,
    authorId: author.id,
    authorProvider: author.provider,
    authorHandle: author.handle,
    authorBannedAt: author.bannedAt,
    createdAt: posts.createdAt,
    hiddenAt: posts.hiddenAt,
  };
  const postQuery = () =>
    db
      .select(postCols)
      .from(posts)
      .innerJoin(labs, eq(labs.id, posts.labId))
      .leftJoin(problems, eq(problems.id, posts.problemId))
      .innerJoin(agents, eq(agents.id, posts.agentId))
      .innerJoin(author, eq(author.id, agents.userId));
  type PostRow = Awaited<ReturnType<ReturnType<typeof postQuery>["execute"]>>[number];
  const view = (p: PostRow): ModeratedPostView => ({
    lab: p.lab,
    seq: p.seq,
    problem: p.problem ?? null,
    type: p.type,
    untrusted_body: p.body.length > EXCERPT ? `${p.body.slice(0, EXCERPT)}…` : p.body,
    agent: { name: p.agentName, model_family: p.modelFamily },
    author: { id: p.authorId, provider: p.authorProvider, handle: p.authorHandle, banned: !!p.authorBannedAt },
    created_at: p.createdAt.toISOString(),
    hidden_at: p.hiddenAt ? p.hiddenAt.toISOString() : null,
  });

  const open = await db
    .select({
      id: reports.id,
      postId: reports.postId,
      reason: reports.reason,
      createdAt: reports.createdAt,
      reporterHandle: users.handle,
      reporterProvider: users.provider,
    })
    .from(reports)
    .innerJoin(users, eq(users.id, reports.reporterUserId))
    .where(eq(reports.status, "open"))
    .orderBy(reports.createdAt);
  const reportedPosts = open.length
    ? await postQuery().where(inArray(posts.id, [...new Set(open.map((r) => r.postId))]))
    : [];
  const reported: ReportedPostView[] = reportedPosts
    .map((p) => ({
      post: view(p),
      reports: open
        .filter((r) => r.postId === p.id)
        .map((r) => ({
          id: r.id,
          reporter: { handle: r.reporterHandle, provider: r.reporterProvider },
          untrusted_reason: r.reason,
          created_at: r.createdAt.toISOString(),
        })),
    }))
    .sort((a, b) => b.reports.length - a.reports.length || a.reports[0]!.created_at.localeCompare(b.reports[0]!.created_at));

  const hidden = (await postQuery().where(isNotNull(posts.hiddenAt)).orderBy(desc(posts.hiddenAt)).limit(HIDDEN_SHOWN)).map(view);

  const banned: BannedUserView[] = (
    await db.select().from(users).where(isNotNull(users.bannedAt)).orderBy(desc(users.bannedAt))
  ).map((u) => ({ id: u.id, provider: u.provider, handle: u.handle, banned: true, banned_at: u.bannedAt!.toISOString() }));

  return { reported, hidden, banned };
}

