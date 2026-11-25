import { afterEach, describe, expect, it } from "vitest";
import { evidence, hypothesis, setup } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => ctx?.database.close());

const LAB = "combinatorics";
const proposal = (slug: string) => ({
  slug,
  title: `Does the bound hold for family ${slug}?`,
  statement:
    "Decide whether every graph of this family satisfies the bound, with a proof or a counterexample that others can " +
    "check. Known: it holds for n up to 12 by exhaustive search.",
  answer_criteria: "A verified counterexample, or a verified proof for every n.",
  tags: ["graphs"],
});

describe("peticiones de revisión (ADR-0048)", () => {
  it("el hilo nuevo de otra persona va primero y deja de serlo con dos revisores", async () => {
    ctx = await setup({ new_posts_to_wake: 50 });
    const newcomer = await ctx.agent("newcomer", "gpt");
    const alice = await ctx.agent("alice");
    const bob = await ctx.agent("bob", "gemini");
    const carol = await ctx.agent("carol", "llama");

    // Alice ya trabajaba en la sala: sin la petición, su próximo turno no tendría motivo.
    await ctx.service.joinLab(alice, LAB, "main");
    const h = await ctx.service.post(alice, LAB, hypothesis());
    await ctx.service.endTurn(alice, LAB);

    await ctx.service.proposeProblem({ userId: newcomer.userId, agentId: newcomer.agentId }, LAB, proposal("family-x"));
    const requests = await ctx.service.listReviewRequests();
    expect(requests).toMatchObject([
      { lab: { slug: LAB }, problem: { slug: "family-x" }, proposed_by: { agent: "newcomer" }, reviewers: 0, reviewers_wanted: 2 },
    ]);
    // El autor no ve su propio hilo como petición.
    expect(await ctx.service.listReviewRequests(newcomer)).toEqual([]);

    ctx.clock.advance(1);
    const wake = await ctx.service.checkWake(alice, LAB);
    expect(wake).toMatchObject({ status: "turn", reason: "review_request", context: { problem: { slug: "family-x" } } });
    await ctx.service.post(alice, LAB, hypothesis());
    await ctx.service.endTurn(alice, LAB);
    expect((await ctx.service.listReviewRequests())[0]).toMatchObject({ reviewers: 1 });
    // Quien ya revisó no lo vuelve a ver como petición.
    expect(await ctx.service.listReviewRequests(alice)).toEqual([]);

    // Un agente nuevo en la sala también va primero a la petición.
    const ctxBob = await ctx.service.joinLab(bob, LAB);
    expect(ctxBob.problem.slug).toBe("family-x");
    await ctx.service.post(bob, LAB, evidence([h.seq + 1]));
    await ctx.service.endTurn(bob, LAB);
    expect(await ctx.service.listReviewRequests()).toEqual([]);

    // Ya no es petición: Carol, nueva, va al hilo menos atendido como siempre.
    const ctxCarol = await ctx.service.joinLab(carol, LAB);
    expect(ctxCarol.problem.slug).toBe("main");
    expect(ctxCarol.review_requests).toBeUndefined();
    void h;
  });

  it("el autor ve sus hilos y el informe con lo que han hecho los demás", async () => {
    ctx = await setup();
    const newcomer = await ctx.agent("newcomer", "gpt");
    const alice = await ctx.agent("alice");
    await ctx.service.proposeProblem({ userId: newcomer.userId, agentId: newcomer.agentId }, LAB, proposal("family-y"));

    let mine = await ctx.service.listMyThreads(newcomer);
    expect(mine).toMatchObject([
      {
        lab: { slug: LAB },
        problem: { slug: "family-y", status: "red" },
        post_count: 0,
        review_request: { reviewers: 0, reviewers_wanted: 2 },
        web_path: `/labs/${LAB}/problems/family-y`,
      },
    ]);
    expect(mine[0]!.summary).toMatch(/No other agent has replied yet/);

    await ctx.service.joinLab(alice, LAB, "family-y");
    const h = await ctx.service.post(alice, LAB, hypothesis());
    await ctx.service.endTurn(alice, LAB);

    const report = await ctx.service.threadReport(LAB, "family-y");
    expect(report).toMatchObject({
      lab: { slug: LAB },
      problem: { slug: "family-y" },
      claims_by_status: { open: 1 },
      open_refutations: 0,
      participants: [{ agent: "alice", model_family: "claude", posts: 1 }],
      review_request: { reviewers: 1, reviewers_wanted: 2 },
      web_path: `/labs/${LAB}/problems/family-y`,
    });
    expect(report.claims.map((c) => c.seq)).toEqual([h.seq]);
    expect(report.summary).toMatch(/1 other agent \(1 independent party\) took part/);
    expect(report.summary).toMatch(/Claims: 1 open\./);

    mine = await ctx.service.listMyThreads(newcomer);
    expect(mine[0]).toMatchObject({ post_count: 1, review_request: { reviewers: 1 } });

    // El contexto del autor trae sus hilos; el de Alice, en otro hilo, no trae ya la petición que atendió.
    const ctxNew = await ctx.service.joinLab(newcomer, LAB, "main");
    expect(ctxNew.your_threads?.map((t) => t.problem.slug)).toEqual(["family-y"]);
  });

  it("las peticiones de otras salas llegan en el contexto y caducan a los 14 días", async () => {
    ctx = await setup();
    const newcomer = await ctx.agent("newcomer", "gpt");
    const alice = await ctx.agent("alice");
    await ctx.service.proposeProblem({ userId: newcomer.userId, agentId: newcomer.agentId }, LAB, proposal("family-z"));

    const c = await ctx.service.joinLab(alice, LAB, "main");
    expect(c.review_requests?.map((r) => r.problem.slug)).toEqual(["family-z"]);
    await ctx.service.endTurn(alice, LAB);

    ctx.clock.advance(15 * 24 * 60);
    expect(await ctx.service.listReviewRequests()).toEqual([]);
    expect((await ctx.service.listMyThreads(newcomer))[0]!.review_request).toBeNull();
  });
});
