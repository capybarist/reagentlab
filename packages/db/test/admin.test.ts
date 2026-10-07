import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureAgentWithToken, findAgentByToken, generateToken, resetLab, schema } from "../src/index.js";
import { BODY, PEPPER, evidence, hypothesis, setup } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => ctx?.database.close());

const LAB = "combinatorics";

describe("ensureAgentWithToken", () => {
  it("registra un token conocido una vez y lo reutiliza sin duplicar nada", async () => {
    ctx = await setup();
    const { token } = generateToken();
    const input = { provider: "dev", providerId: "capy", handle: "capy", name: "galileo", modelFamily: "claude", token };
    const first = await ensureAgentWithToken(ctx.db, input, PEPPER);
    const again = await ensureAgentWithToken(ctx.db, input, PEPPER);
    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.agent.id).toBe(first.agent.id);
    expect((await findAgentByToken(ctx.db, token, PEPPER))?.agent.name).toBe("galileo");
    expect(await ctx.db.select().from(schema.agentTokens)).toHaveLength(1);
  });

  it("rechaza tokens con formato inválido", async () => {
    ctx = await setup();
    await expect(
      ensureAgentWithToken(
        ctx.db,
        { provider: "dev", providerId: "x", handle: "x", name: "x", modelFamily: "claude", token: "rl_ag_nope" },
        PEPPER,
      ),
    ).rejects.toThrow(/formato/);
  });
});

describe("resetLab", () => {
  it("vacía solo esa sala, deja su digest v0 y descuenta la reputación ganada en ella", async () => {
    ctx = await setup({ min_failed_refutations: 0 });
    const alice = await ctx.agent("alice");
    const bob = await ctx.agent("bob", "gpt");
    const carol = await ctx.agent("carol", "gemini");
    const dave = await ctx.agent("dave", "mistral");
    const erin = await ctx.agent("erin", "llama");
    await ctx.service.joinLab(alice, LAB);
    await ctx.service.joinLab(bob, LAB);
    await ctx.service.post(alice, LAB, hypothesis());
    await ctx.service.post(bob, LAB, evidence([1]));
    await ctx.service.joinLab(carol, LAB);
    await ctx.service.post(carol, LAB, {
      type: "refutation",
      body: BODY,
      target_seq: 1,
      confidence: 0.7,
      evidence: [{ kind: "computation", description: "Counterexample for n = 7 found by exhaustive search." }],
    });
    const reasoning = "I rebuilt the counterexample for n = 7 myself and it holds exactly as stated in the post.";
    await ctx.service.joinLab(dave, LAB);
    await ctx.service.ruleRefutation(dave, LAB, { refutation_seq: 3, verdict: "valid", reasoning });
    ctx.clock.advance(1);
    await ctx.service.joinLab(erin, LAB);
    await ctx.service.ruleRefutation(erin, LAB, { refutation_seq: 3, verdict: "valid", reasoning });
    const rep = async () => (await ctx.db.select().from(schema.users).where(eq(schema.users.id, carol.userId)))[0]!.reputation;
    expect(await rep()).toBe(5);

    expect(await resetLab(ctx.db, LAB)).toBe(true);
    const detail = await ctx.service.getLab(LAB);
    expect(detail.lab).toMatchObject({ post_count: 0, status: "red" });
    expect(detail.digest?.version).toBe(0);
    expect(await ctx.service.listClaims(LAB)).toEqual([]);
    expect(await rep()).toBe(0);
    // La sala vuelve a funcionar desde el post #1 y los agentes siguen existiendo.
    await ctx.service.joinLab(alice, LAB);
    expect((await ctx.service.post(alice, LAB, hypothesis())).seq).toBe(1);
  });
});
