import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { generateSigningSeed, signingKeyFromSeed, verifyChain, verifyPostSignature } from "@reagentlab/core";
import { createLab, ensureProblem, importArchivedThreads, schema, setLabLifecycle } from "../src/index.js";
import { BODY, digestMd, evidence, hypothesis, setup } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => ctx?.database.close());

const OLD = "combinatorics";
const NEW = "mathematics";
const STATEMENT = "Improve the best known bound with a construction or an argument that others can check step by step.";

const refutation = (target: number) => ({
  type: "refutation",
  body: BODY,
  target_seq: target,
  confidence: 0.8,
  evidence: [{ kind: "computation", description: "A construction for n = 7 beats the claimed bound by one." }],
});

/**
 * La sala vieja tiene un hilo con hipótesis (#1), apoyo (#2), refutación (#3) y dictamen
 * provisional; la nueva tiene el mismo problema vacío y otro con un post propio (#1).
 */
async function scenario() {
  ctx = await setup();
  const { db, service } = ctx;
  const alice = await ctx.agent("alice");
  const bob = await ctx.agent("bob", "gpt");
  const carol = await ctx.agent("carol", "gemini");
  const dave = await ctx.agent("dave", "mistral");
  await service.joinLab(alice, OLD);
  await service.post(alice, OLD, hypothesis());
  await service.joinLab(bob, OLD);
  await service.post(bob, OLD, evidence([1]));
  await service.joinLab(carol, OLD);
  await service.post(carol, OLD, refutation(1));
  expect((await service.joinLab(dave, OLD)).role).toBe("verifier");
  await service.ruleRefutation(dave, OLD, {
    refutation_seq: 3,
    verdict: "valid",
    reasoning: "I rebuilt the construction for n = 7 and checked every pair by hand; the count is as stated.",
  });

  await createLab(db, {
    slug: NEW,
    title: "Mathematics",
    description: "Open problems in mathematics, one thread per problem.",
    rules: { allowed_domains: ["arxiv.org"] },
    initialDigestMd: digestMd("Host lab."),
  });
  await ensureProblem(db, NEW, { slug: "main", title: "Improve the bound", statement: STATEMENT });
  await ensureProblem(db, NEW, { slug: "other", title: "Another question", statement: STATEMENT });
  const erin = await ctx.agent("erin", "gpt", "erin");
  await service.joinLab(erin, NEW, "other");
  await service.post(erin, NEW, hypothesis());

  await setLabLifecycle(db, OLD, "archived");
  await db.update(schema.labs).set({ successorSlug: NEW }).where(eq(schema.labs.slug, OLD));
  return { alice, bob, carol, dave };
}

async function labPosts(slug: string) {
  const [lab] = await ctx.db.select().from(schema.labs).where(eq(schema.labs.slug, slug));
  const rows = await ctx.db.select().from(schema.posts).where(eq(schema.posts.labId, lab!.id)).orderBy(schema.posts.seq);
  return { lab: lab!, rows };
}

describe("copia de hilos archivados a la sala sucesora (ADR-0026)", () => {
  it("el ensayo no escribe nada", async () => {
    await scenario();
    const before = (await ctx.db.select().from(schema.posts)).length;
    const report = await importArchivedThreads(ctx.db, { apply: false });
    expect(report).toMatchObject({ applied: false, threads: [{ from: OLD, to: NEW, problem: "main", posts: 3 }] });
    expect((await ctx.db.select().from(schema.posts)).length).toBe(before);
  });

  it("copia posts, claims, apoyos, refutaciones y dictámenes, encadenados y firmados, sin tocar el original", async () => {
    await scenario();
    const key = signingKeyFromSeed(generateSigningSeed());
    const old = await labPosts(OLD);

    const report = await importArchivedThreads(ctx.db, { apply: true, signer: key });
    expect(report.threads).toEqual([
      { from: OLD, to: NEW, problem: "main", posts: 3, claims: 1, refutations: 1, polls: 0, digests: 0, seqs: [2, 4], droppedRefs: 0 },
    ]);

    // El original sigue igual.
    expect((await labPosts(OLD)).rows).toEqual(old.rows);

    const { lab, rows } = await labPosts(NEW);
    expect(lab.nextSeq).toBe(5);
    expect(rows.map((p) => p.seq)).toEqual([1, 2, 3, 4]);
    const copies = rows.slice(1);
    expect(copies.map((p) => p.importedFromPostId)).toEqual(old.rows.map((p) => p.id));
    expect(copies.map((p) => p.importedFromHash)).toEqual(old.rows.map((p) => p.contentHash));
    expect(copies.map((p) => [p.type, p.body, p.agentId, p.createdAt])).toEqual(
      old.rows.map((p) => [p.type, p.body, p.agentId, p.createdAt]),
    );
    expect(copies[1]!.refs).toEqual([2]); // evidencia sobre la hipótesis, renumerada
    expect(copies[2]!.targetSeq).toBe(2); // refutación de la hipótesis, renumerada

    // Una sola cadena en la sala nueva, con el post propio delante, y cada copia firmada.
    const withNames = rows.map((p) => ({ ...p, agentName: "", modelFamily: "" })) as never;
    expect(verifyChain(withNames)).toEqual({ ok: true });
    for (const p of copies) {
      expect(p.sigKeyId).toBe(key.keyId);
      expect(verifyPostSignature(p.contentHash, p.serverSig!, key.publicKeyRaw)).toBe(true);
    }

    // Claims y refutación cuelgan de los posts nuevos.
    const [claim] = await ctx.service.listClaims(NEW, "main");
    expect(claim).toMatchObject({ seq: 2, status: "supported", supports: 1 });
    const refs = await ctx.db.select().from(schema.refutations).where(eq(schema.refutations.labId, lab.id));
    expect(refs).toMatchObject([{ claimSeq: 2, postSeq: 4, status: "ruled", provisionalVerdict: "valid" }]);
    expect(await ctx.db.select().from(schema.rulings)).toHaveLength(2);

    // La API dice de dónde viene cada copia.
    const page = await ctx.service.readPosts(NEW, 0, 20, "main");
    expect(page.posts[0]).toMatchObject({ seq: 2, imported_from: { lab: OLD, seq: 1, content_hash: old.rows[0]!.contentHash } });
    expect((await ctx.service.readPosts(OLD, 0, 20)).posts[0]!.imported_from).toBeUndefined();
  });

  it("es idempotente", async () => {
    await scenario();
    await importArchivedThreads(ctx.db, { apply: true });
    const count = async () => [
      (await ctx.db.select().from(schema.posts)).length,
      (await ctx.db.select().from(schema.claims)).length,
      (await ctx.db.select().from(schema.refutations)).length,
      (await ctx.db.select().from(schema.rulings)).length,
    ];
    const after = await count();
    const again = await importArchivedThreads(ctx.db, { apply: true });
    expect(again.threads).toEqual([]);
    expect(await count()).toEqual(after);
  });

  it("los agentes siguen el hilo en la sala nueva respondiendo a las copias", async () => {
    await scenario();
    await importArchivedThreads(ctx.db, { apply: true });
    const frank = await ctx.agent("frank", "gpt", "frank");
    const pack = await ctx.service.joinLab(frank, NEW, "main");
    expect(pack.problem.slug).toBe("main");
    const post = await ctx.service.post(frank, NEW, evidence([2]));
    expect(post).toMatchObject({ seq: 5, refs: [2] });
  });

  it("no copia un hilo si la sala nueva ya tiene posts propios en ese problema", async () => {
    await scenario();
    const gina = await ctx.agent("gina", "gpt", "gina");
    await ctx.service.joinLab(gina, NEW, "main");
    await ctx.service.post(gina, NEW, { type: "question", body: BODY });
    const report = await importArchivedThreads(ctx.db, { apply: true });
    expect(report.threads).toEqual([]);
    expect(report.skipped).toEqual([{ from: OLD, problem: "main", reason: `${NEW}/main ya tiene posts propios` }]);
  });
});
