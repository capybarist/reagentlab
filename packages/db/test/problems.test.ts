import { afterEach, describe, expect, it } from "vitest";
import { DomainError } from "@reagentlab/core";
import { ensureProblem } from "../src/index.js";
import { BODY, evidence, hypothesis, setup } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => ctx?.database.close());

const LAB = "combinatorics";

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof DomainError && e.code === code);
}

const STATEMENT =
  "Decide whether every graph of this family has the property, with a proof or a counterexample. Known: holds for n up to 12.";

/** Sala con dos problemas activos: "main" (del helper) y "second". */
async function twoProblems(rules: Record<string, unknown> = {}) {
  ctx = await setup(rules);
  await ensureProblem(ctx.db, LAB, { slug: "second", title: "A second problem", statement: STATEMENT });
}

describe("problemas (ADR-0020)", () => {
  it("cada problema tiene su propio hilo: el contexto y las referencias no se mezclan", async () => {
    await twoProblems();
    const a = await ctx.agent("alice");
    const b = await ctx.agent("bob", "gpt");
    const pa = await ctx.service.joinLab(a, LAB, "main");
    expect(pa.problem.slug).toBe("main");
    expect(pa.other_problems.map((p) => p.slug)).toEqual(["second"]);
    const h = await ctx.service.post(a, LAB, hypothesis());

    const pb = await ctx.service.joinLab(b, LAB, "second");
    expect(pb.problem.slug).toBe("second");
    expect(pb.delta.posts).toEqual([]);
    // Primer post de un problema vacío: no tiene que responder a nada, aunque la sala tenga posts.
    const h2 = await ctx.service.post(b, LAB, hypothesis());
    expect(h2.problem).toBe("second");
    // Y no puede citar posts de otro problema.
    await expectCode(ctx.service.post(b, LAB, evidence([h.seq])), "REF_NOT_FOUND");

    expect((await ctx.service.readPosts(LAB, 0, 20, "main")).posts.map((p) => p.seq)).toEqual([h.seq]);
    expect((await ctx.service.listClaims(LAB, "second")).map((c) => c.seq)).toEqual([h2.seq]);
  });

  it("sin problema elegido, el servidor da el que lleva más tiempo sin atender", async () => {
    await twoProblems();
    const a = await ctx.agent("alice");
    const b = await ctx.agent("bob", "gpt");
    const first = (await ctx.service.joinLab(a, LAB)).problem.slug;
    ctx.clock.advance(1);
    const second = (await ctx.service.joinLab(b, LAB)).problem.slug;
    expect(new Set([first, second])).toEqual(new Set(["main", "second"]));
  });

  it("wait_for_turn despierta en el problema donde le han respondido", async () => {
    await twoProblems({ new_posts_to_wake: 50 });
    const a = await ctx.agent("alice");
    const b = await ctx.agent("bob", "gpt");
    await ctx.service.joinLab(a, LAB, "second");
    const h = await ctx.service.post(a, LAB, hypothesis());
    await ctx.service.endTurn(a, LAB);

    await ctx.service.joinLab(b, LAB, "second");
    await ctx.service.post(b, LAB, evidence([h.seq]));
    const res = await ctx.service.checkWake(a, LAB);
    expect(res).toMatchObject({ status: "turn", reason: "reply_to_you", context: { problem: { slug: "second" } } });
  });

  it("el escriba y el digest son de cada problema", async () => {
    await twoProblems({ digest_stale_after_posts: 3, max_posts_per_turn: 10 });
    const a = await ctx.agent("alice");
    await ctx.service.joinLab(a, LAB, "main");
    let last = (await ctx.service.post(a, LAB, hypothesis())).seq;
    for (let i = 0; i < 2; i++) last = (await ctx.service.post(a, LAB, hypothesis({ refs: [last] }))).seq;
    // "main" necesita escriba; "second" no.
    const s1 = await ctx.agent("sam", "mistral");
    expect((await ctx.service.joinLab(s1, LAB, "second")).role).not.toBe("scribe");
    const s2 = await ctx.agent("sue", "llama");
    const pack = await ctx.service.joinLab(s2, LAB, "main");
    expect(pack.role).toBe("scribe");
    expect(pack.digest?.version).toBe(0);
    expect(pack.digest?.untrusted_content_md).toContain("Improve the bound");
  });

  it("proponer, aprobar y rechazar problemas", async () => {
    ctx = await setup();
    const a = await ctx.agent("alice");
    const proposal = {
      title: "Ramsey-type bound for this graph family",
      statement: `${STATEMENT} The best known bound comes from an explicit construction; improving it by one counts.`,
      source_url: "https://arxiv.org/abs/1234.5678",
    };
    const p = await ctx.service.proposeProblem({ userId: a.userId, agentId: a.agentId }, LAB, proposal);
    expect(p).toMatchObject({ slug: "ramsey-type-bound-for-this-graph-family", review: "proposed", proposed_by: { handle: "alice" } });
    // Un problema propuesto no se trabaja ni aparece en la lista pública.
    await expectCode(ctx.service.joinLab(a, LAB, p.slug), "PROBLEM_NOT_ACTIVE");
    expect((await ctx.service.listProblems(LAB)).map((x) => x.slug)).toEqual(["main"]);
    await expectCode(ctx.service.proposeProblem({ userId: a.userId }, LAB, proposal), "PROBLEM_EXISTS");
    await expectCode(
      ctx.service.proposeProblem({ userId: a.userId }, LAB, { ...proposal, title: "Other title", source_url: "https://evil.example/x" }),
      "URL_NOT_ALLOWED",
    );

    const approved = await ctx.service.reviewProblem(LAB, p.slug, { decision: "approve", note: "Clear and checkable." });
    expect(approved).toMatchObject({ review: "active", review_note: "Clear and checkable." });
    const pack = await ctx.service.joinLab(a, LAB, p.slug);
    expect(pack.problem.slug).toBe(p.slug);
    expect(pack.digest?.untrusted_content_md).toContain("Ramsey-type bound");
    await expectCode(ctx.service.reviewProblem(LAB, p.slug, { decision: "reject" }), "PROBLEM_NOT_ACTIVE");

    for (let i = 0; i < 3; i++) {
      await ctx.service.proposeProblem({ userId: a.userId }, LAB, { ...proposal, title: `Pending proposal number ${i}` });
    }
    await expectCode(
      ctx.service.proposeProblem({ userId: a.userId }, LAB, { ...proposal, title: "One too many proposals" }),
      "PROPOSAL_LIMIT",
    );
    const rejected = await ctx.service.reviewProblem(LAB, "pending-proposal-number-0", { decision: "reject", note: "Duplicate." });
    expect(rejected.review).toBe("rejected");
  });

  it("el estado es de cada problema y la sala resume el mejor", async () => {
    await twoProblems({ min_failed_refutations: 0, max_active_turns: 10 });
    const [alice, bob, carol, dave, erin] = await Promise.all([
      ctx.agent("alice"),
      ctx.agent("bob", "gpt"),
      ctx.agent("carol", "gemini"),
      ctx.agent("dave", "mistral"),
      ctx.agent("erin", "llama"),
    ]);
    await ctx.service.joinLab(alice, LAB, "main");
    const h = await ctx.service.post(alice, LAB, hypothesis());
    await ctx.service.joinLab(bob, LAB, "main");
    await ctx.service.post(bob, LAB, evidence([h.seq]));
    await ctx.service.runPolls();
    const [poll] = await ctx.service.listPolls(LAB, "main");
    expect(poll).toBeTruthy();
    for (const v of [bob, carol, dave, erin]) {
      await ctx.service.joinLab(v, LAB, "main");
      await ctx.service.castVote(v, LAB, {
        poll_id: poll!.id,
        stance: "yes",
        reasoning: `${BODY} I checked the argument independently before voting on it.`,
      });
    }
    ctx.clock.advance(25 * 60);
    await ctx.service.runPolls();
    const problems = await ctx.service.listProblems(LAB);
    expect(problems.find((p) => p.slug === "main")?.status).toBe("yellow");
    expect(problems.find((p) => p.slug === "second")?.status).toBe("red");
    expect((await ctx.service.getLab(LAB)).lab.status).toBe("yellow");
  });

  it("una sala sin problemas activos no da turnos", async () => {
    ctx = await setup();
    await ctx.service.reviewProblem(LAB, "main", { decision: "archive" });
    const a = await ctx.agent("alice");
    await expectCode(ctx.service.joinLab(a, LAB), "NO_ACTIVE_PROBLEMS");
  });
});
