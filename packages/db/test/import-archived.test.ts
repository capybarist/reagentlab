import { afterEach, describe, expect, it } from "vitest";
import { DomainError, LabService, signingKeyFromSeed, generateSigningSeed, verifyChain, verifyPostSignature } from "@reagentlab/core";
import { eq } from "drizzle-orm";
import { createLab, createStore, ensureProblem, schema } from "../src/index.js";
import { digestMd, evidence, hypothesis, setup } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => ctx?.database.close());

const OLD = "combinatorics";
const NEW = "mathematics";
const STATEMENT = "Improve the best known bound with a construction or an argument that others can check step by step.";

/** Sala sucesora con el mismo hilo "main" y otro "other"; la vieja queda archivada apuntando a ella. */
async function archiveIntoSuccessor() {
  await createLab(ctx.db, {
    slug: NEW,
    title: "Mathematics",
    description: "Open problems in mathematics.",
    rules: { allowed_domains: ["arxiv.org", "oeis.org"] },
    initialDigestMd: digestMd("Host statement."),
  });
  await ensureProblem(ctx.db, NEW, { slug: "main", title: "Improve the bound", statement: STATEMENT });
  await ctx.db
    .update(schema.labs)
    .set({ lifecycle: "archived", successorSlug: NEW })
    .where(eq(schema.labs.slug, OLD));
}

async function postsOf(slug: string) {
  const [lab] = await ctx.db.select().from(schema.labs).where(eq(schema.labs.slug, slug));
  const rows = await ctx.db.select().from(schema.posts).where(eq(schema.posts.labId, lab!.id)).orderBy(schema.posts.seq);
  return rows.map((p) => ({ ...p, agentName: "", modelFamily: "" }));
}

describe("importar hilos de una sala archivada (ADR-0026)", () => {
  it("copia los posts a la sucesora con seq, firma y claims nuevos, y conserva el original", async () => {
    ctx = await setup({ max_active_turns: 10 });
    const key = signingKeyFromSeed(generateSigningSeed());
    const service = new LabService(createStore(ctx.db), ctx.clock, key);
    const alice = await ctx.agent("alice");
    const bob = await ctx.agent("bob", "gpt");

    // En la sala vieja: hipótesis de alice (#1), pregunta de bob (#2) y evidencia de bob sobre #1 (#3).
    await service.joinLab(alice, OLD);
    await service.post(alice, OLD, hypothesis());
    await service.endTurn(alice, OLD);
    await service.joinLab(bob, OLD);
    await service.post(bob, OLD, { type: "question", body: "A question about the construction that is long enough.", refs: [1] });
    await service.post(bob, OLD, evidence([1, 2]));
    await service.endTurn(bob, OLD);
    const originals = await postsOf(OLD);

    await archiveIntoSuccessor();
    const report = await service.importArchivedLab(OLD);
    expect(report).toEqual({ from: OLD, to: NEW, imported: 3, skippedProblems: [] });

    const imported = (await service.readPosts(NEW)).posts;
    expect(imported.map((p) => [p.seq, p.type, p.agent.name, p.refs, p.imported_from?.seq])).toEqual([
      [1, "hypothesis", "alice", [], 1],
      [2, "question", "bob", [1], 2],
      [3, "evidence", "bob", [1, 2], 3],
    ]);
    expect(imported[0]!.problem).toBe("main");
    expect(imported[0]!.created_at).toBe(originals[0]!.createdAt.toISOString());
    expect(imported[0]!.imported_from).toMatchObject({ lab: OLD, content_hash: originals[0]!.contentHash });

    // Cadena de la sala nueva válida y cada post firmado de nuevo.
    const rows = await postsOf(NEW);
    expect(verifyChain(rows as never)).toEqual({ ok: true });
    for (const p of rows) expect(verifyPostSignature(p.contentHash, p.serverSig!, key.publicKeyPem)).toBe(true);
    // El original sigue intacto en la sala archivada.
    expect(await postsOf(OLD)).toEqual(originals);

    // El claim nace de la hipótesis importada; la evidencia de otra persona lo apoya.
    const claims = await service.listClaims(NEW);
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ seq: 1, status: "supported" });

    // Idempotente: volver a importar no duplica nada.
    expect((await service.importArchivedLabs())[0]).toMatchObject({ imported: 0 });
    expect((await service.readPosts(NEW)).posts).toHaveLength(3);

    // Los agentes siguen trabajando en el hilo nuevo, respondiendo a lo importado.
    const pack = await service.joinLab(alice, NEW, "main");
    expect(pack.problem.slug).toBe("main");
  });

  it("no mezcla un hilo que ya tiene posts propios ni importa hilos que no existen en la sucesora", async () => {
    ctx = await setup({ max_active_turns: 10 });
    const alice = await ctx.agent("alice");
    await ensureProblem(ctx.db, OLD, { slug: "lost", title: "A thread only in the old lab", statement: STATEMENT });
    await ctx.service.joinLab(alice, OLD, "main");
    await ctx.service.post(alice, OLD, hypothesis());
    await ctx.service.endTurn(alice, OLD);
    await ctx.service.joinLab(alice, OLD, "lost");
    await ctx.service.post(alice, OLD, hypothesis());
    await ctx.service.endTurn(alice, OLD);

    await archiveIntoSuccessor();
    await ctx.service.joinLab(alice, NEW, "main");
    await ctx.service.post(alice, NEW, hypothesis());
    await ctx.service.endTurn(alice, NEW);

    const report = await ctx.service.importArchivedLab(OLD);
    expect(report).toMatchObject({ imported: 0, skippedProblems: ["main", "lost"] });
    expect((await ctx.service.readPosts(NEW)).posts).toHaveLength(1);
  });

  it("solo importa salas archivadas con sucesora", async () => {
    ctx = await setup();
    await expect(ctx.service.importArchivedLab(OLD)).rejects.toSatisfy(
      (e: unknown) => e instanceof DomainError && e.code === "VALIDATION_FAILED",
    );
    expect(await ctx.service.importArchivedLabs()).toEqual([]);
  });
});
