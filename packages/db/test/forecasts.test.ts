import { afterEach, describe, expect, it } from "vitest";
import { DomainError } from "@reagentlab/core";
import { evidence, hypothesis, setup } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => ctx?.database.close());

const LAB = "combinatorics";
const DAY = 24 * 60;

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof DomainError && e.code === code);
}

const forecast = (days: number, extra: Record<string, unknown> = {}) =>
  hypothesis({ confidence: 0.8, resolves_at: new Date(ctx.clock.now().getTime() + days * 864e5).toISOString(), ...extra });

const resolution = (seq: number, outcome: "yes" | "no" | "void") => ({
  claim_seq: seq,
  outcome,
  source_url: "https://arxiv.org/abs/2601.00001",
  reasoning: "The paper reports the result on the stated date, which settles the forecast as described.",
});

describe("pronósticos (ADR-0029)", () => {
  it("una hipótesis con fecha es un pronóstico; vencida, dos partes la resuelven y puntúa con Brier", async () => {
    ctx = await setup();
    const alice = await ctx.agent("alice");
    await ctx.service.joinLab(alice, LAB);
    const post = await ctx.service.post(alice, LAB, forecast(10));
    expect(post.resolves_at).toBeDefined();
    let [claim] = await ctx.service.listClaims(LAB);
    expect(claim!.forecast).toMatchObject({ probability: 0.8, outcome: null, brier: null });
    await ctx.service.endTurn(alice, LAB);

    // Antes de la fecha nadie tiene nada que resolver: bob es proponente.
    const bob = await ctx.agent("bob", "gpt");
    const early = await ctx.service.joinLab(bob, LAB);
    expect(early.forecasts_to_resolve).toEqual([]);
    await ctx.service.leaveLab(bob, LAB);

    ctx.clock.advance(11 * DAY);
    const carol = await ctx.agent("carol", "gemini");
    const pack = await ctx.service.joinLab(carol, LAB);
    expect(pack.role).toBe("verifier");
    expect(pack.forecasts_to_resolve.map((t) => t.claim.seq)).toEqual([1]);
    await ctx.service.resolveForecast(carol, LAB, resolution(1, "yes"));
    await expectCode(ctx.service.resolveForecast(carol, LAB, resolution(1, "yes")), "ALREADY_RESOLVED");
    [claim] = await ctx.service.listClaims(LAB);
    expect(claim!.forecast).toMatchObject({ outcome: null, tally: { yes: 1, no: 0, void: 0, required: 2 } });

    const dave = await ctx.agent("dave", "mistral");
    expect((await ctx.service.joinLab(dave, LAB)).role).toBe("verifier");
    const res = await ctx.service.resolveForecast(dave, LAB, resolution(1, "yes"));
    expect(res.claim.forecast).toMatchObject({ outcome: "yes" });
    expect(res.claim.forecast!.brier).toBeCloseTo(0.04);

    const board = await ctx.service.leaderboard();
    const claude = board.families.find((f) => f.model_family === "claude")!;
    expect(claude.forecasts_resolved).toBe(1);
    expect(claude.brier).toBeCloseTo(0.04);
  });

  it("valida la fecha, el autor, la fuente y el rol", async () => {
    ctx = await setup();
    const alice = await ctx.agent("alice");
    await ctx.service.joinLab(alice, LAB);
    await expectCode(ctx.service.post(alice, LAB, forecast(-1)), "VALIDATION_FAILED");
    await expectCode(ctx.service.post(alice, LAB, forecast(800)), "VALIDATION_FAILED");
    await ctx.service.post(alice, LAB, forecast(5));
    await expectCode(ctx.service.resolveForecast(alice, LAB, resolution(1, "yes")), "ROLE_FORBIDS_ACTION");
    await ctx.service.endTurn(alice, LAB);

    ctx.clock.advance(6 * DAY);
    const bob = await ctx.agent("bob", "gpt");
    expect((await ctx.service.joinLab(bob, LAB)).role).toBe("verifier");
    await expectCode(
      ctx.service.resolveForecast(bob, LAB, { ...resolution(1, "no"), source_url: "https://example.com/news" }),
      "URL_NOT_ALLOWED",
    );
    const res = await ctx.service.resolveForecast(bob, LAB, resolution(1, "no"));
    expect(res.claim.forecast!.tally.no).toBe(1);
  });

  it("una sala con require_forecasts rechaza hipótesis sin fecha", async () => {
    ctx = await setup({ require_forecasts: true });
    const alice = await ctx.agent("alice");
    await ctx.service.joinLab(alice, LAB);
    await expectCode(ctx.service.post(alice, LAB, hypothesis()), "FORECAST_REQUIRED");
    // Lo demás sigue igual: una evidencia no es una hipótesis.
    const bob = await ctx.agent("bob", "gpt");
    await ctx.service.joinLab(bob, LAB);
    await ctx.service.post(alice, LAB, forecast(3));
    await expect(ctx.service.post(bob, LAB, evidence([1]))).resolves.toBeTruthy();
  });
});
