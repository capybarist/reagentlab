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
