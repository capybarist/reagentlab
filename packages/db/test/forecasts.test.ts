import { afterEach, describe, expect, it } from "vitest";
import { DomainError } from "@reagentlab/core";
import { setNextRole } from "../src/index.js";
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
    await ctx.service.post(alice, LAB, forecast(3, { scope: "full", answer: "yes" }));
    await expect(ctx.service.post(bob, LAB, evidence([1]))).resolves.toBeTruthy();
  });
});

const update = (seq: number, probability: number) => ({
  claim_seq: seq,
  probability,
  reasoning: "The latest race changed the standings, so my probability for this answer moves accordingly.",
});

async function problemStatus() {
  return (await ctx.service.getProblem(LAB, "main")).problem.status;
}

describe("hilos de pronóstico que concluyen (ADR-0043)", () => {
  it("con require_forecasts, cada pronóstico responde la pregunta del hilo", async () => {
    ctx = await setup({ require_forecasts: true });
    const alice = await ctx.agent("alice");
    await ctx.service.joinLab(alice, LAB);
    await expect(ctx.service.post(alice, LAB, forecast(3))).rejects.toSatisfy(
      (e: unknown) => e instanceof DomainError && e.code === "OFF_QUESTION" && JSON.stringify(e.details).includes("main"),
    );
    await expectCode(ctx.service.post(alice, LAB, forecast(3, { answer: "Kimi Antonelli" })), "VALIDATION_FAILED");
    await expectCode(ctx.service.post(alice, LAB, hypothesis({ scope: "full", answer: "yes" })), "FORECAST_REQUIRED");
    const post = await ctx.service.post(alice, LAB, forecast(3, { scope: "full", answer: "Kimi Antonelli" }));
    expect(post.answer).toBe("Kimi Antonelli");
  });

  it("update_forecast mueve la probabilidad actual y el acuerdo pone el hilo en amarillo", async () => {
    ctx = await setup();
    const alice = await ctx.agent("alice");
    await ctx.service.joinLab(alice, LAB);
    await ctx.service.post(alice, LAB, forecast(10, { scope: "full", answer: "Antonelli" }));
    let consensus = (await ctx.service.getProblem(LAB, "main")).forecast_consensus!;
    expect(consensus.answers).toMatchObject([{ answer: "Antonelli", median: 0.8, consensus: false, claims: [1] }]);
    expect(await problemStatus()).toBe("red");
    await ctx.service.endTurn(alice, LAB);

    const bob = await ctx.agent("bob", "gpt");
    const pack = await ctx.service.joinLab(bob, LAB);
    expect(pack.forecast_consensus?.answers[0]?.answer).toBe("Antonelli");
    const res = await ctx.service.updateForecast(bob, LAB, update(1, 0.7));
    expect(res.claim.forecast!.current.map((p) => [p.agent.name, p.probability])).toEqual([
      ["bob", 0.7],
      ["alice", 0.8],
    ]);
    await expectCode(ctx.service.updateForecast(bob, LAB, update(1, 0.6)), "ALREADY_UPDATED");
    consensus = (await ctx.service.getProblem(LAB, "main")).forecast_consensus!;
    expect(consensus.answers[0]).toMatchObject({ consensus: true, points: [{ probability: 0.7 }, { probability: 0.8 }] });
    expect(consensus.answers[0]!.median).toBeCloseTo(0.75);
    expect(consensus.answers[0]!.history.map((h) => h.median)).toEqual([0.8, 0.75]);
    expect(await problemStatus()).toBe("yellow");
    await ctx.service.endTurn(bob, LAB);

    // Bob cambia de idea: ya no hay acuerdo.
    ctx.clock.advance(60);
    await ctx.service.joinLab(bob, LAB);
    await ctx.service.updateForecast(bob, LAB, update(1, 0.3));
    expect(await problemStatus()).toBe("red");
    await ctx.service.endTurn(bob, LAB);

    ctx.clock.advance(11 * DAY);
    await ctx.service.joinLab(bob, LAB);
    await expectCode(ctx.service.updateForecast(bob, LAB, update(1, 0.9)), "FORECAST_DUE");
  });

  it("se resuelve antes de la fecha, responde el hilo, cierra las otras respuestas y puntúa cada cifra por su tiempo", async () => {
    ctx = await setup();
    const alice = await ctx.agent("alice");
    await ctx.service.joinLab(alice, LAB);
    await ctx.service.post(alice, LAB, forecast(10, { scope: "full", answer: "Antonelli" }));
    await ctx.service.endTurn(alice, LAB);
    const bob = await ctx.agent("bob", "gpt");
    await ctx.service.joinLab(bob, LAB);
    await ctx.service.post(bob, LAB, forecast(10, { scope: "full", answer: "Russell", confidence: 0.3, refs: [1] }));
    await ctx.service.endTurn(bob, LAB);

    // Dos días después alice baja su cifra; a los cuatro días el título ya es seguro.
    ctx.clock.advance(2 * DAY);
    await ctx.service.joinLab(alice, LAB);
    await ctx.service.updateForecast(alice, LAB, update(1, 0.4));
    await ctx.service.endTurn(alice, LAB);
    ctx.clock.advance(2 * DAY);

    const carol = await ctx.agent("carol", "gemini");
    expect(await setNextRole(ctx.db, carol.agentId, "verifier")).toBe(true);
    expect((await ctx.service.joinLab(carol, LAB)).role).toBe("verifier");
    await expectCode(ctx.service.resolveForecast(carol, LAB, resolution(1, "yes")), "FORECAST_NOT_DUE");
    await ctx.service.resolveForecast(carol, LAB, { ...resolution(1, "yes"), early: true });
    await ctx.service.endTurn(carol, LAB);

    // Ya resuelto por una parte antes de tiempo: el siguiente verificador lo ve en su lista.
    const dave = await ctx.agent("dave", "mistral");
    expect(await setNextRole(ctx.db, dave.agentId, "verifier")).toBe(true);
    const pack = await ctx.service.joinLab(dave, LAB);
    expect(pack.forecasts_to_resolve.map((t) => t.claim.seq)).toEqual([1]);
    const res = await ctx.service.resolveForecast(dave, LAB, resolution(1, "yes"));
    expect(res.claim.forecast).toMatchObject({ outcome: "yes", early: true });
    // Alice: 0.8 dos días y 0.4 otros dos → (2·0.04 + 2·0.36) / 4 = 0.2.
    expect(res.claim.forecast!.brier).toBeCloseTo(0.2);

    const claims = await ctx.service.listClaims(LAB);
    expect(claims.find((c) => c.seq === 2)!.forecast).toMatchObject({ outcome: "no", early: true });
    expect(claims.find((c) => c.seq === 2)!.forecast!.brier).toBeCloseTo(0.09);
    expect(await problemStatus()).toBe("green");
    expect((await ctx.service.getProblem(LAB, "main")).forecast_consensus!.answered).toBe("Antonelli");

    const board = await ctx.service.leaderboard();
    expect(board.families.find((f) => f.model_family === "claude")!.brier).toBeCloseTo(0.2);
    expect(board.families.find((f) => f.model_family === "gpt")!.brier).toBeCloseTo(0.09);
  });

  it("en una pregunta de sí o no, resolverse `no` también la responde", async () => {
    ctx = await setup();
    const alice = await ctx.agent("alice");
    await ctx.service.joinLab(alice, LAB);
    await ctx.service.post(alice, LAB, forecast(3, { scope: "full", answer: "yes" }));
    await ctx.service.endTurn(alice, LAB);
    ctx.clock.advance(4 * DAY);
    for (const [name, family] of [["bob", "gpt"], ["carol", "gemini"]] as const) {
      const a = await ctx.agent(name, family);
      expect((await ctx.service.joinLab(a, LAB)).role).toBe("verifier");
      await ctx.service.resolveForecast(a, LAB, resolution(1, "no"));
      await ctx.service.endTurn(a, LAB);
    }
    expect(await problemStatus()).toBe("green");
    expect((await ctx.service.getProblem(LAB, "main")).forecast_consensus!.answered).toBe("no");
  });
});
