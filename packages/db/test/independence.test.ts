import { afterEach, describe, expect, it } from "vitest";
import { BODY, evidence, hypothesis, setup } from "./helpers.js";

/** La unidad de independencia (ADR-0023): `human` por defecto, `model_family` para instalaciones privadas. */

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => ctx?.database.close());

const LAB = "combinatorics";
const status = async (seq: number) => (await ctx.service.listClaims(LAB)).find((c) => c.seq === seq)?.status;

describe("independencia por parte (ADR-0023)", () => {
  it("human (por defecto): dos agentes del mismo humano no se apoyan entre sí", async () => {
    ctx = await setup();
    const a = await ctx.agent("alice-claude", "claude", "alice");
    const b = await ctx.agent("alice-gpt", "gpt", "alice");
    await ctx.service.joinLab(a, LAB, "main");
    const h = await ctx.service.post(a, LAB, hypothesis());
    await ctx.service.joinLab(b, LAB, "main");
    await ctx.service.post(b, LAB, evidence([h.seq]));
    expect(await status(h.seq)).toBe("open");
  });

  it("model_family: un solo dueño con familias distintas apoya, refuta y vota; la misma familia no", async () => {
    ctx = await setup({ independence: "model_family", min_failed_refutations: 0, max_active_turns: 10 });
    const owner = (name: string, family: string) => ctx.agent(name, family, "owner");
    const claude = await owner("c", "claude");
    const otherClaude = await ctx.agent("someone-else", "claude", "someone");
    const gpt = await owner("g", "gpt");

    await ctx.service.joinLab(claude, LAB, "main");
    const h = await ctx.service.post(claude, LAB, hypothesis());
    // Otro humano pero la misma familia: no es una parte distinta.
    await ctx.service.joinLab(otherClaude, LAB, "main");
    await ctx.service.post(otherClaude, LAB, evidence([h.seq]));
    expect(await status(h.seq)).toBe("open");
    // Mismo dueño, otra familia: sí.
    await ctx.service.joinLab(gpt, LAB, "main");
    await ctx.service.post(gpt, LAB, evidence([h.seq]));
    expect(await status(h.seq)).toBe("supported");

    await ctx.service.runPolls();
    const [poll] = await ctx.service.listPolls(LAB, "main");
    expect(poll).toBeTruthy();
    // La familia del autor es parte del caso y no vota, aunque sea de otro humano.
    await expect(
      ctx.service.castVote(otherClaude, LAB, { poll_id: poll!.id, stance: "yes", reasoning: `${BODY} Checked it.` }),
    ).rejects.toMatchObject({ code: "CONFLICT_OF_INTEREST" });
    // Tres familias del mismo dueño dan quórum: una por parte.
    for (const [name, family] of [["v1", "gemini"], ["v2", "mistral"], ["v3", "llama"]] as const) {
      const v = await owner(name, family);
      await ctx.service.joinLab(v, LAB, "main");
      await ctx.service.castVote(v, LAB, { poll_id: poll!.id, stance: "yes", reasoning: `${BODY} Checked independently.` });
    }
    const second = await owner("v4", "gemini");
    await ctx.service.joinLab(second, LAB, "main");
    await expect(
      ctx.service.castVote(second, LAB, { poll_id: poll!.id, stance: "yes", reasoning: `${BODY} Another gemini agent.` }),
    ).rejects.toMatchObject({ code: "ALREADY_VOTED" });

    ctx.clock.advance(25 * 60);
    await ctx.service.runPolls();
    expect(await status(h.seq)).toBe("adopted");
  });
});
