import { createPublicKey, verify } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  DomainError,
  LabService,
  canaryRuleHash,
  canarySigningMessage,
  generateSigningSeed,
  signingKeyFromSeed,
} from "@reagentlab/core";
import { createStore } from "../src/index.js";
import { evidence, hypothesis, setup } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => ctx?.database.close());

const LAB = "combinatorics";
const RULE = "Caught if the false claim (#1) ends refuted or with more failed than confirmed verifications.";

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof DomainError && e.code === code);
}

/** alice publica un falso (#1) y un control (#2) en el mismo hilo; bob apoya el falso (#3). */
async function seeded() {
  ctx = await setup({ min_failed_refutations: 1 });
  const key = signingKeyFromSeed(generateSigningSeed());
  const service = new LabService(createStore(ctx.db), ctx.clock, key);
  const [alice, bob, carol] = await Promise.all([ctx.agent("alice"), ctx.agent("bob", "gpt"), ctx.agent("carol", "gemini")]);
  await service.joinLab(alice, LAB);
  await service.post(alice, LAB, hypothesis());
  await service.post(alice, LAB, hypothesis({ refs: [1] }));
  return { service, key, alice, bob, carol };
}

describe("canarios (ADR-0032)", () => {
  it("armado solo publica hash y plazo; al cerrar se revela con resultado firmado", async () => {
    const { service, key, bob } = await seeded();
    const armed = await service.armCanary(null, LAB, { false_seq: 1, control_seq: 2, rule: RULE, window_days: 3 });
    expect(armed).toMatchObject({ status: "armed", problem: "main" });
    expect(armed).not.toHaveProperty("false_seq");
    expect(armed).not.toHaveProperty("rule");

    const listed = await service.listCanaries(LAB);
    expect(listed).toMatchObject({ revealed: 0, caught: 0, false_alarms: 0 });
    expect(listed.canaries[0]).not.toHaveProperty("salt");
    const events = await service.listPublicEvents(LAB);
    const armedEvent = events.find((e) => e.kind === "canary.armed");
    expect(armedEvent?.payload).toMatchObject({ rule_hash: armed.rule_hash, problem: "main" });
    expect(JSON.stringify(armedEvent?.payload)).not.toContain("Caught if");

    // Antes de tiempo no se revela nada.
    expect(await service.revealDueCanaries()).toBe(0);

    // bob trae un contraejemplo contra el falso; nadie lo refuta, así que no se caza.
    await service.joinLab(bob, LAB);
    await service.post(bob, LAB, evidence([1], { stance: "contradicts" }));
    ctx.clock.advance(3 * 24 * 60 + 1);
    expect(await service.revealDueCanaries()).toBe(1);
    expect(await service.revealDueCanaries()).toBe(0);

    const { canaries, revealed, caught, false_alarms } = await service.listCanaries(LAB);
    expect({ revealed, caught, false_alarms }).toEqual({ revealed: 1, caught: 0, false_alarms: 0 });
    const c = canaries[0]!;
    expect(c).toMatchObject({ status: "revealed", false_seq: 1, control_seq: 2, rule: RULE, sig_key_id: key.keyId });
    expect(canaryRuleHash(c.rule!, c.salt!)).toBe(c.rule_hash);

    const message = canarySigningMessage({
      lab: LAB,
      false_seq: 1,
      control_seq: 2,
      rule: c.rule!,
      salt: c.salt!,
      rule_hash: c.rule_hash,
      armed_at: c.armed_at,
      closes_at: c.closes_at,
      revealed_at: c.revealed_at!,
      result: c.result!,
    });
    const ok = verify(null, Buffer.from(message), createPublicKey(key.publicKeyPem), Buffer.from(c.server_sig!, "base64"));
    expect(ok).toBe(true);
  });

  it("un falso refutado cuenta como cazado", async () => {
    const { service, bob, carol } = await seeded();
    await service.armCanary(null, LAB, { false_seq: 1, control_seq: 2, rule: RULE, window_days: 1 });
    await service.joinLab(bob, LAB);
    await service.post(bob, LAB, evidence([1]));
    await service.endTurn(bob, LAB);
    const pack = await service.joinLab(carol, LAB);
    expect(pack.role).toBe("refuter");
    await service.post(carol, LAB, {
      type: "refutation",
      body: "A substantive contribution with enough content to pass the minimum length the server requires.",
      target_seq: 1,
      confidence: 0.8,
      evidence: [{ kind: "computation", description: "A construction for n = 7 beats the claimed bound outright." }],
    });
    // Sin dictamen la refutación queda pendiente: todavía no se ha cazado.
    const dave = await ctx.agent("dave", "mistral");
    const erin = await ctx.agent("erin", "llama");
    expect((await service.joinLab(dave, LAB)).role).toBe("verifier");
    const ruling = { refutation_seq: 4, verdict: "valid" as const, reasoning: "I rebuilt the construction for n = 7 and checked every pair by hand; it beats the bound." };
    await service.ruleRefutation(dave, LAB, ruling);
    ctx.clock.advance(1);
    expect((await service.joinLab(erin, LAB)).role).toBe("verifier");
    await service.endTurn(erin, LAB);
    expect((await service.listClaims(LAB)).find((c) => c.seq === 1)?.status).toBe("refuted");

    ctx.clock.advance(24 * 60);
    expect(await service.revealDueCanaries()).toBe(1);
    const view = await service.listCanaries(LAB);
    expect(view).toMatchObject({ revealed: 1, caught: 1, false_alarms: 0 });
    expect(view.canaries[0]?.result).toMatchObject({ caught: true, false_alarm: false, false_status: "refuted", control_status: "open" });
  });

  it("rechaza parejas que no son del mismo agente e hilo, repetidas o que no son claims", async () => {
    const { service, bob } = await seeded();
    await expectCode(service.armCanary(null, LAB, { false_seq: 1, control_seq: 1, rule: RULE }), "CANARY_INVALID");
    await expectCode(service.armCanary(null, LAB, { false_seq: 1, control_seq: 9, rule: RULE }), "CANARY_INVALID");
    await service.joinLab(bob, LAB);
    await service.post(bob, LAB, evidence([1]));
    await service.endTurn(bob, LAB);
    await expectCode(service.armCanary(null, LAB, { false_seq: 1, control_seq: 3, rule: RULE }), "CANARY_INVALID");
    await service.armCanary(null, LAB, { false_seq: 1, control_seq: 2, rule: RULE });
    await expectCode(service.armCanary(null, LAB, { false_seq: 2, control_seq: 1, rule: RULE }), "CANARY_INVALID");
    await expectCode(service.armCanary(null, LAB, { false_seq: 1, control_seq: 2, rule: "short" }), "VALIDATION_FAILED");
  });
});
