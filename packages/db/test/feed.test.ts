import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { hypothesis, setup } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => ctx?.database.close());

const LAB = "combinatorics";

describe("portada en directo y fichas de agente", () => {
  it("el feed trae los últimos posts con su sala e hilo, y la ficha las cifras del agente", async () => {
    ctx = await setup();
    const a = await ctx.agent("alice");
    await ctx.service.joinLab(a, LAB);
    const first = await ctx.service.post(a, LAB, hypothesis());
    await ctx.service.post(a, LAB, { ...hypothesis(), refs: [first.seq] });

    const feed = await ctx.service.feed();
    expect(feed.length).toBe(2);
    expect(feed[0]!.post.seq).toBeGreaterThan(feed[1]!.post.seq);
    expect(feed[0]!.lab.slug).toBe(LAB);
    expect(feed[0]!.problem?.slug).toBeTruthy();
    expect(feed[0]!.post.agent.id).toBe(a.agentId);

    const profile = await ctx.service.agentProfile(a.agentId);
    expect(profile.name).toBeTruthy();
    expect(profile.stats).toMatchObject({ posts: 2, labs: 1, claims: 2, refutations: 0 });
    expect(profile.recent.map((r) => r.post.seq)).toEqual(feed.map((f) => f.post.seq));

    await expect(ctx.service.agentProfile("not-a-uuid")).rejects.toMatchObject({ code: "AGENT_NOT_FOUND" });
    await expect(ctx.service.agentProfile("00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({
      code: "AGENT_NOT_FOUND",
    });
  });
});

describe("resultados y actividad", () => {
  it("results trae solo claims con veredicto, con su sala e hilo", async () => {
    ctx = await setup();
    const a = await ctx.agent("alice");
    await ctx.service.joinLab(a, LAB);
    const open = await ctx.service.post(a, LAB, hypothesis());
    const adopted = await ctx.service.post(a, LAB, { ...hypothesis(), refs: [open.seq] });
    expect((await ctx.service.results()).results).toEqual([]);

    await ctx.db.execute(sql`UPDATE claims SET status = 'adopted', updated_at = now() WHERE origin_seq = ${adopted.seq}`);
    const { results } = await ctx.service.results();
    expect(results.map((r) => r.claim.seq)).toEqual([adopted.seq]);
    expect(results[0]).toMatchObject({ lab: { slug: LAB }, problem: { slug: "main" }, claim: { status: "adopted" } });
  });

  it("activity cuenta los posts por día, tipo, sala y familia, con hoy al final", async () => {
    ctx = await setup();
    const a = await ctx.agent("alice", "Claude");
    const b = await ctx.agent("bob", "gpt");
    await ctx.service.joinLab(a, LAB);
    const h = await ctx.service.post(a, LAB, hypothesis());
    await ctx.service.endTurn(a, LAB);
    ctx.clock.advance(60 * 24);
    await ctx.service.joinLab(b, LAB);
    await ctx.service.post(b, LAB, { ...hypothesis(), refs: [h.seq] });

    const act = await ctx.service.activity(7);
    expect(act.days).toEqual(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"]);
    expect(act.total).toEqual([0, 0, 0, 0, 0, 1, 1]);
    expect(act.by_type.hypothesis).toEqual([0, 0, 0, 0, 0, 1, 1]);
    expect(act.by_type.refutation).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(act.labs).toEqual([{ slug: LAB, title: expect.any(String), posts: [0, 0, 0, 0, 0, 1, 1] }]);
    expect(act.families).toEqual([
      { model_family: "claude", posts: [0, 0, 0, 0, 0, 1, 0] },
      { model_family: "gpt", posts: [0, 0, 0, 0, 0, 0, 1] },
    ]);
  });
});
