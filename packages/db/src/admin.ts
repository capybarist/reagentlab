import { createHash, randomBytes } from "node:crypto";
import type { LabRules } from "@reagentlab/contracts";
import { problemDigestV0 } from "@reagentlab/core";
import { and, asc, count, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "./connection.js";
import {
  agentTokens,
  agents,
  claimSupports,
  claims,
  digests,
  events,
  labs,
  memberships,
  polls,
  posts,
  problems,
  refutations,
  reputationEvents,
  rulings,
  turns,
  users,
  votes,
} from "./schema.js";

/**
 * Operaciones de administración: alta de humanos, agentes, tokens y salas.
 * No son reglas del juego, así que viven aquí y no en core.
 */

export const TOKEN_PREFIX = "rl_ag_";

export function hashToken(token: string, pepper: string): string {
  return createHash("sha256").update(`${pepper}:${token}`).digest("hex");
}

/** Genera un token opaco `rl_ag_<prefijo>_<secreto>` (ADR-0005). Solo se muestra una vez. */
export function generateToken(): { token: string; prefix: string } {
  const prefix = randomBytes(4).toString("hex");
  const secret = randomBytes(24).toString("base64url");
  return { token: `${TOKEN_PREFIX}${prefix}_${secret}`, prefix };
}

export async function upsertUser(
  db: Db,
  u: { provider: string; providerId: string; handle: string; accountCreatedAt?: Date },
) {
  const [existing] = await db
    .select()
    .from(users)
    .where(and(eq(users.provider, u.provider), eq(users.providerId, u.providerId)));
  if (existing) {
    // El handle puede cambiar en el proveedor; el id no.
    if (existing.handle === u.handle) return existing;
    const [row] = await db.update(users).set({ handle: u.handle }).where(eq(users.id, existing.id)).returning();
    return row!;
  }
  const [row] = await db.insert(users).values(u).returning();
  return row!;
}

export async function getUser(db: Db, id: string) {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row ?? null;
}

export async function countActiveAgents(db: Db, userId: string) {
  const [r] = await db
    .select({ n: count() })
    .from(agents)
    .where(and(eq(agents.userId, userId), eq(agents.status, "active")));
  return Number(r!.n);
}

/** Agentes de un humano con sus tokens vigentes (nunca el secreto, solo el prefijo). */
export async function listAgentsWithTokens(db: Db, userId: string) {
  const rows = await db.select().from(agents).where(eq(agents.userId, userId)).orderBy(asc(agents.createdAt));
  if (!rows.length) return [];
  const tokens = await db
    .select()
    .from(agentTokens)
    .where(
      and(
        inArray(
          agentTokens.agentId,
          rows.map((a) => a.id),
        ),
        isNull(agentTokens.revokedAt),
      ),
    )
    .orderBy(asc(agentTokens.createdAt));
  return rows.map((a) => ({ ...a, tokens: tokens.filter((t) => t.agentId === a.id) }));
}

export async function getAgentOfUser(db: Db, userId: string, agentId: string) {
  const [row] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.userId, userId)));
  return row ?? null;
}

export async function issueToken(db: Db, agentId: string, pepper: string) {
  const { token, prefix } = generateToken();
  const [row] = await db
    .insert(agentTokens)
    .values({ agentId, prefix, tokenHash: hashToken(token, pepper) })
    .returning();
  return { token, row: row! };
}

/** Revoca un token concreto de un agente. Devuelve `false` si no existía o ya estaba revocado. */
export async function revokeToken(db: Db, agentId: string, tokenId: string) {
  const rows = await db
    .update(agentTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(agentTokens.id, tokenId), eq(agentTokens.agentId, agentId), isNull(agentTokens.revokedAt)))
    .returning({ id: agentTokens.id });
  return rows.length > 0;
}

/** Desactiva un agente y revoca todos sus tokens: deja de contar para el tope de agentes. */
export async function disableAgent(db: Db, agentId: string) {
  await db.transaction(async (tx) => {
    await tx.update(agents).set({ status: "disabled" }).where(eq(agents.id, agentId));
    await tx
      .update(agentTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(agentTokens.agentId, agentId), isNull(agentTokens.revokedAt)));
  });
}

export async function createAgentWithToken(
  db: Db,
  a: { userId: string; name: string; modelFamily: string },
  pepper: string,
) {
  const [agent] = await db.insert(agents).values(a).returning();
  const { token, prefix } = generateToken();
  await db.insert(agentTokens).values({ agentId: agent!.id, prefix, tokenHash: hashToken(token, pepper) });
  return { agent: agent!, token };
}

/** Formato de un token de agente: `rl_ag_<8 hex>_<secreto>`. */
export const TOKEN_PATTERN = /^rl_ag_([0-9a-f]{8})_[A-Za-z0-9_-]{20,}$/;

/** Agente de un humano por nombre; lo crea si no existe (idempotente). */
export async function findOrCreateAgent(db: Db, a: { userId: string; name: string; modelFamily: string }) {
  const [existing] = await db.select().from(agents).where(and(eq(agents.userId, a.userId), eq(agents.name, a.name)));
  if (existing) return existing;
  const [row] = await db.insert(agents).values(a).returning();
  return row!;
}

/**
 * Deja un humano, su agente y un token CONOCIDO listos, sin duplicar nada si ya
 * existen. Sirve para que el token de la configuración MCP valga siempre, también
 * tras vaciar una sala o recrear la base de desarrollo.
 */
export async function ensureAgentWithToken(
  db: Db,
  a: { provider: string; providerId: string; handle: string; name: string; modelFamily: string; token: string },
  pepper: string,
) {
  const m = TOKEN_PATTERN.exec(a.token);
  if (!m) throw new Error(`Token con formato inválido para ${a.name}: debe ser rl_ag_<8 hex>_<secreto de 20+>.`);
  const user = await upsertUser(db, { provider: a.provider, providerId: a.providerId, handle: a.handle });
  const agent = await findOrCreateAgent(db, { userId: user.id, name: a.name, modelFamily: a.modelFamily });
  const tokenHash = hashToken(a.token, pepper);
  const [existing] = await db.select().from(agentTokens).where(eq(agentTokens.tokenHash, tokenHash));
  if (existing && existing.agentId !== agent.id) throw new Error(`El token de ${a.name} ya pertenece a otro agente.`);
  if (!existing) await db.insert(agentTokens).values({ agentId: agent.id, prefix: m[1]!, tokenHash });
  else if (existing.revokedAt) await db.update(agentTokens).set({ revokedAt: null }).where(eq(agentTokens.id, existing.id));
  if (agent.status !== "active") await db.update(agents).set({ status: "active" }).where(eq(agents.id, agent.id));
  return { user, agent, created: !existing };
}

/**
 * Vacía una sala: posts, claims, polls, turnos, residentes, eventos y digests salvo el
 * v0, y descuenta la reputación que se ganó en ella. La sala, sus normas, los humanos y
 * los agentes se quedan. Es la única forma prevista de "empezar de cero" sin tocar el resto.
 */
export async function resetLab(db: Db, slug: string) {
  return db.transaction(async (tx) => {
    const [lab] = await tx.select().from(labs).where(eq(labs.slug, slug));
    if (!lab) return false;
    const pollIds = tx.select({ id: polls.id }).from(polls).where(eq(polls.labId, lab.id));
    const refIds = tx.select({ id: refutations.id }).from(refutations).where(eq(refutations.labId, lab.id));
    const claimIds = tx.select({ id: claims.id }).from(claims).where(eq(claims.labId, lab.id));

    await tx.delete(votes).where(inArray(votes.pollId, pollIds));
    await tx.delete(polls).where(eq(polls.labId, lab.id));
    await tx.delete(rulings).where(inArray(rulings.refutationId, refIds));
    await tx.delete(refutations).where(eq(refutations.labId, lab.id));
    await tx.delete(claimSupports).where(inArray(claimSupports.claimId, claimIds));
    await tx.delete(claims).where(eq(claims.labId, lab.id));

    // La reputación ganada o perdida en la sala se descuenta antes de borrar sus eventos.
    const gained = await tx
      .select({ userId: reputationEvents.userId, total: sql<number>`sum(${reputationEvents.delta})` })
      .from(reputationEvents)
      .where(eq(reputationEvents.labId, lab.id))
      .groupBy(reputationEvents.userId);
    for (const g of gained) {
      await tx
        .update(users)
        .set({ reputation: sql`${users.reputation} - ${Number(g.total)}` })
        .where(eq(users.id, g.userId));
    }
    await tx.delete(reputationEvents).where(eq(reputationEvents.labId, lab.id));

    await tx.delete(posts).where(eq(posts.labId, lab.id));
    await tx.delete(digests).where(and(eq(digests.labId, lab.id), gt(digests.version, 0)));
    // Los digests v0 de los problemas se quedan; apuntan al principio del hilo vacío.
    await tx.update(digests).set({ basedOnSeq: 0 }).where(eq(digests.labId, lab.id));
    await tx.update(problems).set({ status: "red" }).where(eq(problems.labId, lab.id));
    await tx.delete(turns).where(eq(turns.labId, lab.id));
    await tx.delete(memberships).where(eq(memberships.labId, lab.id));
    await tx.delete(events).where(eq(events.labId, lab.id));
    await tx.update(labs).set({ nextSeq: 1, status: "red" }).where(eq(labs.id, lab.id));
    await tx.insert(events).values({ kind: "moderation.lab_reset", payload: { slug }, public: false });
    return true;
  });
}

/** Busca el agente de un token válido: no revocado, agente activo y humano sin banear. */
export async function findAgentByToken(db: Db, token: string, pepper: string) {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const [row] = await db
    .select({ agent: agents, user: users, tokenId: agentTokens.id })
    .from(agentTokens)
    .innerJoin(agents, eq(agents.id, agentTokens.agentId))
    .innerJoin(users, eq(users.id, agents.userId))
    .where(and(eq(agentTokens.tokenHash, hashToken(token, pepper)), isNull(agentTokens.revokedAt)));
  if (!row || row.agent.status !== "active" || row.user.bannedAt) return null;
  await db.update(agentTokens).set({ lastUsedAt: new Date() }).where(eq(agentTokens.id, row.tokenId));
  return row;
}

export async function revokeAgentTokens(db: Db, agentId: string) {
  await db.update(agentTokens).set({ revokedAt: new Date() }).where(eq(agentTokens.agentId, agentId));
}

export async function createLab(
  db: Db,
  l: {
    slug: string;
    title: string;
    description: string;
    rules: Partial<LabRules>;
    datasets?: unknown[];
    initialDigestMd: string;
    createdBy?: string;
  },
) {
  return db.transaction(async (tx) => {
    const [lab] = await tx
      .insert(labs)
      .values({
        slug: l.slug,
        title: l.title,
        description: l.description,
        rules: l.rules,
        datasets: l.datasets ?? [],
        createdBy: l.createdBy,
      })
      .returning();
    // Digest v0: lo escribe el host con la ficha de la sala (OPEN-QUESTIONS #11).
    await tx.insert(digests).values({ labId: lab!.id, version: 0, contentMd: l.initialDigestMd, basedOnSeq: 0 });
    return lab!;
  });
}

/**
 * Sala del host (seed, ADR-0021): la crea si falta; si existe (o existe con un slug antiguo
 * de `formerSlugs`), la renombra y pone al día título, descripción, normas y los textos v0
 * que escribe el host (la ficha y el v0 de cada problema). No toca posts ni digests v1+.
 */
export async function ensureLab(
  db: Db,
  l: Parameters<typeof createLab>[1] & { formerSlugs?: string[] },
): Promise<{ lab: typeof labs.$inferSelect; action: "created" | "renamed" | "updated"; previousSlug?: string }> {
  const found = await db.select().from(labs).where(inArray(labs.slug, [l.slug, ...(l.formerSlugs ?? [])]));
  const current = found.find((x) => x.slug === l.slug) ?? found[0];
  if (!current) return { lab: await createLab(db, l), action: "created" };
  return db.transaction(async (tx) => {
    const [lab] = await tx
      .update(labs)
      .set({ slug: l.slug, title: l.title, description: l.description, rules: l.rules })
      .where(eq(labs.id, current.id))
      .returning();
    await tx
      .update(digests)
      .set({ contentMd: l.initialDigestMd })
      .where(and(eq(digests.labId, lab!.id), isNull(digests.problemId), eq(digests.version, 0)));
    for (const p of await tx.select().from(problems).where(eq(problems.labId, lab!.id))) {
      await tx
        .update(digests)
        .set({ contentMd: problemDigestV0(lab!, p) })
        .where(and(eq(digests.problemId, p.id), eq(digests.version, 0)));
    }
    if (current.slug === l.slug) return { lab: lab!, action: "updated" as const };
    return { lab: lab!, action: "renamed" as const, previousSlug: current.slug };
  });
}

/**
 * Deja un problema activo en una sala, con su digest v0, si no existe (ADR-0020).
 * Idempotente: si ya existe, no lo toca, salvo `refresh` (seed) en problemas del host.
 */
export async function ensureProblem(
  db: Db,
  labSlug: string,
  p: { slug: string; title: string; statement: string; sourceUrl?: string },
  opts: { refresh?: boolean } = {},
) {
  return db.transaction(async (tx) => {
    const [lab] = await tx.select().from(labs).where(eq(labs.slug, labSlug));
    if (!lab) throw new Error(`No existe la sala ${labSlug}.`);
    const [existing] = await tx.select().from(problems).where(and(eq(problems.labId, lab.id), eq(problems.slug, p.slug)));
    if (existing) {
      // Solo se ponen al día los textos de problemas del host, nunca los propuestos por alguien.
      if (!opts.refresh || existing.proposedByUserId) return { problem: existing, created: false };
      const [problem] = await tx
        .update(problems)
        .set({ title: p.title, statement: p.statement, sourceUrl: p.sourceUrl ?? null })
        .where(eq(problems.id, existing.id))
        .returning();
      await tx
        .update(digests)
        .set({ contentMd: problemDigestV0(lab, problem!) })
        .where(and(eq(digests.problemId, problem!.id), eq(digests.version, 0)));
      return { problem: problem!, created: false };
    }
    const [problem] = await tx
      .insert(problems)
      .values({ labId: lab.id, slug: p.slug, title: p.title, statement: p.statement, sourceUrl: p.sourceUrl ?? null })
      .returning();
    await tx.insert(digests).values({
      labId: lab.id,
      problemId: problem!.id,
      version: 0,
      contentMd: problemDigestV0(lab, { ...p, sourceUrl: p.sourceUrl ?? null }),
      basedOnSeq: lab.nextSeq - 1,
    });
    return { problem: problem!, created: true };
  });
}

// ── Moderación (OPEN-QUESTIONS #6: en Fase 0 modera el host desde la CLI) ──

/** Oculta un post de la web y del contexto de los agentes. Queda en la base y en el log. */
export async function hidePost(db: Db, labSlug: string, seq: number, reason: string) {
  return db.transaction(async (tx) => {
    const [lab] = await tx.select().from(labs).where(eq(labs.slug, labSlug));
    if (!lab) return false;
    const rows = await tx
      .update(posts)
      .set({ hiddenAt: new Date() })
      .where(and(eq(posts.labId, lab.id), eq(posts.seq, seq), isNull(posts.hiddenAt)))
      .returning({ id: posts.id });
    if (!rows.length) return false;
    await tx.insert(events).values({ labId: lab.id, kind: "moderation.post_hidden", payload: { seq, reason }, public: false });
    return true;
  });
}

/** Banea a un humano: sus tokens dejan de valer al instante (findAgentByToken lo comprueba). */
export async function banUser(db: Db, provider: string, handle: string, reason: string) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(users)
      .set({ bannedAt: new Date() })
      .where(and(eq(users.provider, provider), eq(users.handle, handle), isNull(users.bannedAt)))
      .returning({ id: users.id });
    if (!rows.length) return false;
    await tx.insert(events).values({ kind: "moderation.user_banned", payload: { user_id: rows[0]!.id, reason }, public: false });
    return true;
  });
}
