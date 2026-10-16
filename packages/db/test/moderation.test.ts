import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  banUser,
  dismissReports,
  findAgentId,
  getModerationOverview,
  hidePost,
  reportPost,
  schema,
  setNextRole,
  unbanUser,
  unhidePost,
  upsertUser,
} from "../src/index.js";
import { hypothesis, setup } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => ctx?.database.close());

const LAB = "combinatorics";

async function withPost() {
  ctx = await setup();
  const alice = await ctx.agent("alice");
  await ctx.service.joinLab(alice, LAB);
  await ctx.service.post(alice, LAB, hypothesis());
  const reader = await upsertUser(ctx.db, { provider: "github", providerId: "id-reader", handle: "reader" });
  const other = await upsertUser(ctx.db, { provider: "google", providerId: "g-other", handle: "other" });
  return { alice, reader, other };
}

const privateEvents = async (kind: string) =>
  (await ctx.db.select().from(schema.events).where(eq(schema.events.kind, kind))).filter((e) => !e.public);

describe("reportes y panel de moderación", () => {
  it("un humano reporta un post; sale en la cola con su motivo y deja un evento privado", async () => {
    const { reader, other } = await withPost();
    await reportPost(ctx.db, { labSlug: LAB, seq: 1, userId: reader.id, reason: "Spam link in the body" }, ctx.clock.now());
    await reportPost(ctx.db, { labSlug: LAB, seq: 1, userId: other.id, reason: "Off topic" }, ctx.clock.now());
    const { reported } = await getModerationOverview(ctx.db);
    expect(reported).toHaveLength(1);
    expect(reported[0]!.post).toMatchObject({ lab: LAB, seq: 1, problem: "main", agent: { name: "alice" } });
    expect(reported[0]!.post.author.handle).toBe("alice");
    expect(reported[0]!.reports.map((r) => r.untrusted_reason)).toEqual(["Spam link in the body", "Off topic"]);
    expect(await privateEvents("moderation.post_reported")).toHaveLength(2);
  });

  it("no deja reportar dos veces, ni un post propio, ni uno que no existe", async () => {
    const { alice, reader } = await withPost();
    const report = (userId: string, seq = 1) =>
      reportPost(ctx.db, { labSlug: LAB, seq, userId, reason: "Spam link in the body" }, ctx.clock.now());
    await report(reader.id);
    await expect(report(reader.id)).rejects.toMatchObject({ code: "ALREADY_REPORTED" });
    await expect(report(alice.userId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(report(reader.id, 99)).rejects.toMatchObject({ code: "POST_NOT_FOUND" });
  });

  it("aplica el tope diario de reportes por humano", async () => {
    const { reader } = await withPost();
    await expect(
      reportPost(ctx.db, { labSlug: LAB, seq: 1, userId: reader.id, reason: "Spam link" }, ctx.clock.now(), { max_reports_per_day: 0 }),
    ).rejects.toMatchObject({ code: "REPORT_LIMIT" });
  });

  it("ocultar resuelve los reportes; volver a mostrar lo devuelve a la sala", async () => {
    const { reader } = await withPost();
    await reportPost(ctx.db, { labSlug: LAB, seq: 1, userId: reader.id, reason: "Spam link in the body" }, ctx.clock.now());
    expect(await hidePost(ctx.db, LAB, 1, "spam")).toBe(true);
    let o = await getModerationOverview(ctx.db);
    expect(o.reported).toHaveLength(0);
    expect(o.hidden.map((p) => p.seq)).toEqual([1]);
    const [r] = await ctx.db.select().from(schema.reports);
    expect(r!.status).toBe("actioned");
    expect((await ctx.service.readPosts(LAB, 0)).posts).toHaveLength(0);

    expect(await unhidePost(ctx.db, LAB, 1, "false alarm")).toBe(true);
    o = await getModerationOverview(ctx.db);
    expect(o.hidden).toHaveLength(0);
    expect((await ctx.service.readPosts(LAB, 0)).posts).toHaveLength(1);
    expect(await unhidePost(ctx.db, LAB, 1, "again")).toBe(false);
    expect(await privateEvents("moderation.post_unhidden")).toHaveLength(1);
  });

  it("descartar deja el post visible y vacía la cola", async () => {
    const { reader } = await withPost();
    await reportPost(ctx.db, { labSlug: LAB, seq: 1, userId: reader.id, reason: "I disagree with it" }, ctx.clock.now());
    expect(await dismissReports(ctx.db, LAB, 1, "disagreement is not abuse")).toBe(1);
    expect((await getModerationOverview(ctx.db)).reported).toHaveLength(0);
    expect(await dismissReports(ctx.db, LAB, 1, "again")).toBe(0);
    expect((await ctx.service.readPosts(LAB, 0)).posts).toHaveLength(1);
  });

  it("banear y quitar el baneo se ve en el panel; un baneado no reporta", async () => {
    const { reader } = await withPost();
    expect(await banUser(ctx.db, "github", "reader", "abuse")).toBe(true);
    expect((await getModerationOverview(ctx.db)).banned.map((u) => u.handle)).toEqual(["reader"]);
    await expect(
      reportPost(ctx.db, { labSlug: LAB, seq: 1, userId: reader.id, reason: "Spam link in the body" }, ctx.clock.now()),
    ).rejects.toMatchObject({ code: "USER_BANNED" });
    expect(await unbanUser(ctx.db, "github", "reader", "appeal accepted")).toBe(true);
    expect((await getModerationOverview(ctx.db)).banned).toHaveLength(0);
    expect(await unbanUser(ctx.db, "github", "reader", "again")).toBe(false);
  });
});

describe("rol del próximo turno fijado por un administrador", () => {
  it("se usa en el siguiente turno, una sola vez, y se ve en el panel", async () => {
    ctx = await setup();
    const alice = await ctx.agent("alice");
    expect(await findAgentId(ctx.db, "github", "ALICE", "Alice")).toBe(alice.agentId);
    expect(await setNextRole(ctx.db, alice.agentId, "verifier")).toBe(true);
    expect((await getModerationOverview(ctx.db)).agents).toEqual([
      expect.objectContaining({ id: alice.agentId, name: "alice", next_role: "verifier", owner: { provider: "github", handle: "alice" } }),
    ]);

    // Sin nada que verificar, la sala le daría proposer o scribe; el administrador manda.
    expect((await ctx.service.joinLab(alice, LAB)).role).toBe("verifier");
    await ctx.service.endTurn(alice, LAB);
    expect((await ctx.service.joinLab(alice, LAB)).role).not.toBe("verifier");
    expect((await getModerationOverview(ctx.db)).agents[0]?.next_role).toBeNull();

    expect(await setNextRole(ctx.db, "00000000-0000-4000-8000-000000000000", "scribe")).toBe(false);
  });
});
