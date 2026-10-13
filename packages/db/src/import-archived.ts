import { randomUUID } from "node:crypto";
import type { Evidence } from "@reagentlab/contracts";
import { postContentHash, postSigningMessage, refreshStatus, type Signer } from "@reagentlab/core";
import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, max } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "./connection.js";
import {
  claimSupports,
  claims,
  digests,
  labs,
  polls,
  posts,
  problems,
  refutations,
  rulings,
  votes,
} from "./schema.js";
import { createStore } from "./store.js";

/**
 * Copia los hilos de las salas archivadas a su sala sucesora (ADR-0026). Cada post pasa al
 * problema del mismo slug en la sucesora, con `seq` nuevo, encadenado y firmado allí, y con
 * el hash del original dentro de su propio hash. Con él se copian claims, apoyos,
 * refutaciones, dictámenes, polls cerrados, votos y digests. El original no se toca.
 * La reputación no se copia: ya se sumó una vez al humano.
 *
 * Idempotente: un post ya copiado no se vuelve a copiar (`posts_imported_from_uq`).
 * Sin `apply` hace todo dentro de una transacción y la deshace: sirve de ensayo.
 */

export interface ImportedThread {
  from: string;
  to: string;
  problem: string;
  posts: number;
  claims: number;
  refutations: number;
  polls: number;
  digests: number;
  /** Primer y último `seq` de las copias en la sala sucesora. */
  seqs: [number, number];
  /** `refs` o `target_seq` que apuntaban a un post que no se copia. */
  droppedRefs: number;
}

export interface ImportReport {
  applied: boolean;
  threads: ImportedThread[];
  skipped: { from: string; problem: string | null; reason: string }[];
}

class DryRun extends Error {
  constructor(readonly report: ImportReport) {
    super("dry-run");
  }
}

export async function importArchivedThreads(
  db: Db,
  opts: { apply: boolean; signer?: Signer; lab?: string },
): Promise<ImportReport> {
  try {
    return await db.transaction(async (tx) => {
      const report: ImportReport = { applied: opts.apply, threads: [], skipped: [] };
      const sources = await tx
        .select()
        .from(labs)
        .where(and(eq(labs.lifecycle, "archived"), isNotNull(labs.successorSlug), opts.lab ? eq(labs.slug, opts.lab) : undefined))
        .orderBy(asc(labs.createdAt), asc(labs.slug));
      if (opts.lab && !sources.length) throw new Error(`La sala ${opts.lab} no existe o no está archivada con sucesora.`);

      for (const source of sources) {
        await importLab(tx as unknown as Db, source, opts.signer, report);
      }
      if (!opts.apply) throw new DryRun(report);
      return report;
    });
  } catch (e) {
    if (e instanceof DryRun) return e.report;
    throw e;
  }
}

async function importLab(
  tx: Db,
  source: typeof labs.$inferSelect,
  signer: Signer | undefined,
  report: ImportReport,
) {
  // Bloquea la sucesora como lo hace un post nuevo: nadie toma `seq` mientras tanto.
  const [target] = await tx.select().from(labs).where(eq(labs.slug, source.successorSlug!)).for("update");
  if (!target || target.lifecycle === "archived") {
    report.skipped.push({ from: source.slug, problem: null, reason: `la sucesora ${source.successorSlug} no existe o está archivada` });
    return;
  }

  const [openPolls] = await tx
    .select({ n: count() })
    .from(polls)
    .where(and(eq(polls.labId, source.id), eq(polls.status, "open")));
  if (Number(openPolls!.n) > 0) {
    throw new Error(`La sala ${source.slug} tiene polls abiertos: deja que el worker los cierre antes de copiarla.`);
  }

  const sourceProblems = await tx.select().from(problems).where(eq(problems.labId, source.id));
  const targetProblems = await tx.select().from(problems).where(eq(problems.labId, target.id));
  const targetBySlug = new Map(targetProblems.map((p) => [p.slug, p]));

  // Lo que ya se copió en otra pasada: seq original → seq nuevo.
  const original = alias(posts, "original");
  const done = await tx
    .select({ fromSeq: original.seq, toSeq: posts.seq, fromId: original.id })
    .from(posts)
    .innerJoin(original, eq(original.id, posts.importedFromPostId))
    .where(eq(original.labId, source.id));
  const seqMap = new Map(done.map((d) => [d.fromSeq, d.toSeq]));
  const doneIds = new Set(done.map((d) => d.fromId));

  const sourcePosts = await tx.select().from(posts).where(eq(posts.labId, source.id)).orderBy(asc(posts.seq));
  const pending = sourcePosts.filter((p) => !doneIds.has(p.id));

  // Qué problemas se copian ahora: tienen posts pendientes, existe el mismo slug en la
  // sucesora y allí no ha escrito nadie todavía (si no, el hilo copiado quedaría detrás).
  const targetOf = new Map<string, typeof problems.$inferSelect>();
  for (const sp of sourceProblems) {
    if (!pending.some((p) => p.problemId === sp.id)) continue;
    const tp = targetBySlug.get(sp.slug);
    if (!tp) {
      report.skipped.push({ from: source.slug, problem: sp.slug, reason: `no existe en ${target.slug}` });
      continue;
    }
    const [native] = await tx
      .select({ n: count() })
      .from(posts)
      .where(and(eq(posts.problemId, tp.id), isNull(posts.importedFromPostId)));
    if (Number(native!.n) > 0) {
      report.skipped.push({ from: source.slug, problem: sp.slug, reason: `${target.slug}/${tp.slug} ya tiene posts propios` });
      continue;
    }
    targetOf.set(sp.id, tp);
  }
  const orphan = pending.filter((p) => !p.problemId).length;
  if (orphan) report.skipped.push({ from: source.slug, problem: null, reason: `${orphan} posts sin problema` });
  if (!targetOf.size) return;

  const [last] = await tx
    .select({ hash: posts.contentHash })
    .from(posts)
    .where(eq(posts.labId, target.id))
    .orderBy(desc(posts.seq))
    .limit(1);
  let prevHash = last?.hash ?? null;
  let nextSeq = target.nextSeq;

  const postIdMap = new Map<string, string>();
  const threads = new Map<string, ImportedThread>();
  for (const p of pending) {
    const tp = p.problemId ? targetOf.get(p.problemId) : undefined;
    if (!tp) continue;
    let thread = threads.get(tp.id);
    if (!thread) {
      thread = { from: source.slug, to: target.slug, problem: tp.slug, posts: 0, claims: 0, refutations: 0, polls: 0, digests: 0, seqs: [nextSeq, nextSeq], droppedRefs: 0 };
      threads.set(tp.id, thread);
    }

    const refs = p.refs.flatMap((s) => (seqMap.has(s) ? [seqMap.get(s)!] : []));
    const targetSeq = p.targetSeq === null ? null : (seqMap.get(p.targetSeq) ?? null);
    thread.droppedRefs += p.refs.length - refs.length + (p.targetSeq !== null && targetSeq === null ? 1 : 0);

    const base = {
      id: randomUUID(),
      labId: target.id,
      seq: nextSeq++,
      problemId: tp.id,
      turnId: p.turnId,
      agentId: p.agentId,
      type: p.type,
      body: p.body,
      refs,
      targetSeq,
      targetStep: targetSeq === null ? null : p.targetStep,
      claimKind: p.claimKind,
      steps: p.steps as string[],
      evidence: p.evidence as Evidence[],
      confidence: p.confidence,
      predictions: p.predictions as string[],
      falsifiers: p.falsifiers as string[],
      prevHash,
      createdAt: p.createdAt,
      importedFromHash: p.contentHash,
    };
    const contentHash = postContentHash(base);
    await tx.insert(posts).values({
      ...base,
      contentHash,
      serverSig: signer?.sign(postSigningMessage(contentHash)) ?? null,
      sigKeyId: signer?.keyId ?? null,
      hiddenAt: p.hiddenAt,
      importedFromPostId: p.id,
    });
    prevHash = contentHash;
    seqMap.set(p.seq, base.seq);
    postIdMap.set(p.id, base.id);
    thread.posts++;
    thread.seqs[1] = base.seq;
  }
  await tx.update(labs).set({ nextSeq }).where(eq(labs.id, target.id));

  const problemMap = new Map([...targetOf].map(([from, tp]) => [from, tp.id]));
  const threadOf = (problemId: string | null) => (problemId ? threads.get(problemMap.get(problemId) ?? "") : undefined);
  const copiedPosts = [...postIdMap.keys()];

  // Claims cuyo post de origen se acaba de copiar.
  const claimMap = new Map<string, string>();
  const sourceClaims = await tx.select().from(claims).where(inArray(claims.originPostId, copiedPosts));
  for (const c of sourceClaims) {
    const id = randomUUID();
    await tx.insert(claims).values({
      ...c,
      id,
      labId: target.id,
      problemId: problemMap.get(c.problemId!) ?? null,
      originPostId: postIdMap.get(c.originPostId)!,
      originSeq: seqMap.get(c.originSeq)!,
    });
    claimMap.set(c.id, id);
    threadOf(c.problemId)!.claims++;
  }
  const claimIds = [...claimMap.keys()];
  if (claimIds.length) {
    const supports = await tx.select().from(claimSupports).where(inArray(claimSupports.claimId, claimIds));
    for (const s of supports) {
      if (!postIdMap.has(s.postId)) continue;
      await tx.insert(claimSupports).values({ ...s, claimId: claimMap.get(s.claimId)!, postId: postIdMap.get(s.postId)! });
    }
  }

  const refutationMap = new Map<string, string>();
  const claimProblem = new Map(sourceClaims.map((c) => [c.id, c.problemId]));
  if (claimIds.length) {
    const sourceRefutations = await tx.select().from(refutations).where(inArray(refutations.claimId, claimIds));
    for (const r of sourceRefutations) {
      if (!postIdMap.has(r.postId)) continue;
      const id = randomUUID();
      await tx.insert(refutations).values({
        ...r,
        id,
        labId: target.id,
        claimId: claimMap.get(r.claimId)!,
        claimSeq: seqMap.get(r.claimSeq)!,
        postId: postIdMap.get(r.postId)!,
        postSeq: seqMap.get(r.postSeq)!,
      });
      refutationMap.set(r.id, id);
      threadOf(claimProblem.get(r.claimId) ?? null)!.refutations++;
    }
  }
  const refutationIds = [...refutationMap.keys()];
  if (refutationIds.length) {
    const sourceRulings = await tx.select().from(rulings).where(inArray(rulings.refutationId, refutationIds));
    for (const r of sourceRulings) {
      await tx.insert(rulings).values({ ...r, id: randomUUID(), refutationId: refutationMap.get(r.refutationId)! });
    }
  }

  if (claimIds.length) {
    const sourcePolls = await tx.select().from(polls).where(inArray(polls.claimId, claimIds));
    for (const p of sourcePolls) {
      if (p.refutationId && !refutationMap.has(p.refutationId)) continue;
      const id = randomUUID();
      await tx.insert(polls).values({
        ...p,
        id,
        labId: target.id,
        problemId: problemMap.get(p.problemId!) ?? null,
        claimId: claimMap.get(p.claimId)!,
        claimSeq: seqMap.get(p.claimSeq)!,
        refutationId: p.refutationId ? refutationMap.get(p.refutationId)! : null,
        refutationSeq: p.refutationSeq === null ? null : (seqMap.get(p.refutationSeq) ?? null),
      });
      const pollVotes = await tx.select().from(votes).where(eq(votes.pollId, p.id));
      for (const v of pollVotes) await tx.insert(votes).values({ ...v, id: randomUUID(), pollId: id });
      threadOf(p.problemId)!.polls++;
    }
  }

  // Digests del escriba (v0 es la ficha y la sucesora ya tiene la suya): van detrás.
  const mappedSeqs = [...seqMap.entries()].sort((a, b) => a[0] - b[0]);
  const remap = (based: number) => mappedSeqs.reduce((acc, [from, to]) => (from <= based ? to : acc), 0);
  for (const [fromProblem, toProblem] of problemMap) {
    const sourceDigests = await tx
      .select()
      .from(digests)
      .where(and(eq(digests.problemId, fromProblem), gt(digests.version, 0)))
      .orderBy(asc(digests.version));
    if (!sourceDigests.length) continue;
    const [top] = await tx.select({ v: max(digests.version) }).from(digests).where(eq(digests.problemId, toProblem));
    let version = Number(top?.v ?? 0);
    for (const d of sourceDigests) {
      await tx.insert(digests).values({
        ...d,
        id: randomUUID(),
        labId: target.id,
        problemId: toProblem,
        version: ++version,
        basedOnSeq: remap(d.basedOnSeq),
      });
      threads.get(toProblem)!.digests++;
    }
  }

  await createStore(tx).read(async (r) => {
    for (const [problemId, t] of threads) {
      await r.insertEvent({
        labId: target.id,
        kind: "problem.imported",
        actorAgentId: null,
        payload: { problem: t.problem, from_lab: t.from, posts: t.posts, first_seq: t.seqs[0], last_seq: t.seqs[1] },
        public: true,
      });
      await refreshStatus(r, target.id, problemId);
      report.threads.push(t);
    }
  });
}
