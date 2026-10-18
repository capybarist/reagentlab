import { createPublicKey, verify } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  DomainError,
  LabService,
  arenaRoundSigningMessage,
  generateSigningSeed,
  signingKeyFromSeed,
  trapCommitment,
} from "@reagentlab/core";
import type { LabRules } from "@reagentlab/contracts";
import { createLab, createStore } from "../src/index.js";
import { digestMd, hypothesis, setup } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => ctx?.database.close());

const LAB = "arena";
const steps = ["Assume n is odd.", "Then n² is odd.", "So n² + 1 is even."];
const derivation = (extra: Record<string, unknown> = {}) => hypothesis({ claim_kind: "derivation", steps, ...extra });
const REASON = "I redid the step myself and the inference from the previous step does hold as the refutation says.";

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof DomainError && e.code === code);
}

async function arena() {
  ctx = await setup();
  await createLab(ctx.db, {
    slug: LAB,
    title: "Arena",
    description: "Refutation tournaments with elimination.",
    rules: {
      template: "arena",
      arena: { min_entries: 2, registration_hours: 1, postpone_hours: 24, round_hours: 2, turns_per_round: 2 },
    } as Partial<LabRules>,
    initialDigestMd: digestMd("Arena."),
  });
  const key = signingKeyFromSeed(generateSigningSeed());
  const service = new LabService(createStore(ctx.db), ctx.clock, key);
  const [alice, bob, carol] = await Promise.all([ctx.agent("alice"), ctx.agent("bob", "gpt"), ctx.agent("carol", "gemini")]);
  return { service, key, alice, bob, carol };
}

/** Publica una pareja de derivaciones y entrega la trampa; devuelve los seqs. */
async function plant(service: LabService, who: Parameters<LabService["post"]>[0], brokenIndex: 0 | 1, brokenStep: number) {
  const pack = await service.joinLab(who, LAB);
  expect(pack.role).toBe("proposer");
  expect(pack.arena?.you.trap_submitted).toBe(false);
  const a = await service.post(who, LAB, derivation());
  const b = await service.post(who, LAB, derivation());
  const seqs: [number, number] = [a.seq, b.seq];
  const trap = await service.submitTrap(who, LAB, {
    seqs,
    broken_seq: seqs[brokenIndex],
    broken_step: brokenStep,
    witness: "n = 3 is a counterexample to the broken step.",
  });
  expect(trap).not.toHaveProperty("broken_seq");
  await service.endTurn(who, LAB);
  return seqs;
}

describe("Arena (ADR-0040)", () => {
  it("abre torneo, inscribe, puntúa, elimina y corona", async () => {
    const { service, key, alice, bob, carol } = await arena();

    expect((await service.runArena())[LAB]).toEqual({ opened: 1 });
    await expectCode(service.joinLab(alice, LAB), "ARENA_CLOSED");
    for (const a of [alice, bob, carol]) await service.joinArena(a, LAB);
    await expectCode(service.joinArena(alice, LAB), "ALREADY_ENTERED");
    // Otro agente de la misma persona no puede inscribirse: una entrada por parte.
    const alice2 = { ...(await ctx.agent("alice-2", "claude", "alice")) };
    await expectCode(service.joinArena(alice2, LAB), "ALREADY_ENTERED");

    ctx.clock.advance(61);
    expect((await service.runArena())[LAB]).toEqual({ started: 1 });
    await expectCode(service.joinArena(bob, LAB), "ARENA_CLOSED");

    const [a1] = await plant(service, alice, 0, 2); // alice: rota la primera, paso 2
    // Una trampa por ronda.
    await expectCode(service.submitTrap(alice, LAB, { seqs: [1, 2], broken_seq: 1, broken_step: 2, witness: "again, n = 3." }), "NO_ACTIVE_TURN");
    await plant(service, bob, 1, 1);
    const [, c2] = await plant(service, carol, 0, 3); // carol: la segunda es la correcta

    // Mientras la ronda está abierta, nadie ve cuál es la rota.
    const open = await service.getArena(LAB);
    expect(open.current?.rounds[0]?.open_traps).toHaveLength(3);
    expect(JSON.stringify(open)).not.toContain("witness");

    // bob caza a alice en el paso bueno y acusa la correcta de carol.
    const hunt = await service.joinLab(bob, LAB);
    expect(hunt.role).toBe("refuter");
    expect(hunt.arena?.traps_to_hunt.map((t) => t.agent_name).sort()).toEqual(["alice", "carol"]);
    const refBody = { type: "refutation", body: "Step 2 does not follow: n = 3 is a counterexample to it, as computed.", confidence: 0.8, evidence: [{ kind: "computation", description: "n = 3 gives a contradiction with step 2." }] };
    await service.post(bob, LAB, { ...refBody, target_seq: a1, target_step: 2 });
    await service.post(bob, LAB, { ...refBody, target_seq: c2, target_step: 1 });
    await service.endTurn(bob, LAB);

    // carol puede dictaminar la refutación de bob a alice; dice que es válida.
    const rule = await service.joinLab(carol, LAB);
    expect(rule.role).toBe("verifier");
    const refSeq = rule.rulings_needed.find((x) => x.claim.seq === a1)!.refutation.seq;
    await service.ruleRefutation(carol, LAB, { refutation_seq: refSeq, verdict: "valid", reasoning: REASON });
    await service.endTurn(carol, LAB);

    ctx.clock.advance(121);
    expect((await service.runArena())[LAB]).toEqual({ closedRound: 1 });

    const after = await service.getArena(LAB);
    const r1 = after.current!.rounds[0]!;
    const score = (n: string) => r1.result!.scores.find((s) => s.agent_name === n)!;
    expect(score("bob")).toMatchObject({ score: 3, catches: 1, false_alarms: 1, survived: 1, eliminated: false });
    expect(score("carol")).toMatchObject({ score: 2, survived: 1, eliminated: false });
    expect(score("alice")).toMatchObject({ score: 0, eliminated: true, reason: "lowest_score" });

    // El compromiso y la firma se comprueban con lo revelado.
    for (const t of r1.result!.traps) {
      expect(trapCommitment({ seqs: t.seqs, broken_seq: t.broken_seq, broken_step: t.broken_step, witness: t.witness }, t.salt)).toBe(t.commitment);
    }
    const ok = verify(null, Buffer.from(arenaRoundSigningMessage(r1.result)), createPublicKey(key.publicKeyPem), Buffer.from(r1.server_sig!, "base64"));
    expect(ok).toBe(true);
    expect(after.current!.rounds).toHaveLength(2);
    await expectCode(service.joinLab(alice, LAB), "ARENA_NOT_ENTERED");

    // Ronda 2: carol no pone trampa y cae; bob queda solo y gana.
    await plant(service, bob, 0, 1);
    ctx.clock.advance(121);
    expect((await service.runArena())[LAB]).toEqual({ closedRound: 2, finished: 1 });
    const done = await service.getArena(LAB);
    expect(done.current).toMatchObject({ status: "finished", champion: { agent: { name: "bob" } } });
    expect(done.current!.entries.find((e) => e.agent.name === "carol")).toMatchObject({ status: "eliminated", eliminated_reason: "no_trap" });

    // Al terminar se abre la inscripción del siguiente.
    expect((await service.runArena())[LAB]).toEqual({ opened: 2 });
    expect((await service.getArena(LAB)).past[0]).toMatchObject({ number: 1, champion: { agent: { name: "bob" } } });
  });

  it("se aplaza si no hay inscritos suficientes y valida las trampas", async () => {
    const { service, alice, bob } = await arena();
    await service.runArena();
    await service.joinArena(alice, LAB);
    ctx.clock.advance(61);
    expect((await service.runArena())[LAB]).toEqual({ postponed: 1 });
    await service.joinArena(bob, LAB);
    ctx.clock.advance(24 * 60 + 1);
    expect((await service.runArena())[LAB]).toEqual({ started: 1 });

    await service.joinLab(alice, LAB);
    await expectCode(service.post(alice, LAB, hypothesis()), "VALIDATION_FAILED"); // conjecture no vale en la Arena
    const a = await service.post(alice, LAB, derivation());
    const b = await service.post(alice, LAB, hypothesis({ claim_kind: "computation", evidence: [{ kind: "computation", description: "Ran it for n up to 100." }] }));
    await expectCode(service.submitTrap(alice, LAB, { seqs: [a.seq, b.seq], broken_seq: a.seq, broken_step: 2, witness: "n = 3 breaks it." }), "TRAP_INVALID");
    const c = await service.post(alice, LAB, derivation());
    await expectCode(service.submitTrap(alice, LAB, { seqs: [a.seq, c.seq], broken_seq: a.seq, witness: "n = 3 breaks it." }), "TRAP_INVALID");
    await service.submitTrap(alice, LAB, { seqs: [a.seq, c.seq], broken_seq: a.seq, broken_step: 2, witness: "n = 3 breaks it." });
    await expectCode(service.submitTrap(alice, LAB, { seqs: [a.seq, c.seq], broken_seq: a.seq, broken_step: 2, witness: "n = 3 breaks it." }), "TRAP_EXISTS");
    await expectCode(service.getArena("combinatorics"), "ARENA_CLOSED");
  });
});
