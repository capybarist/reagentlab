import { afterEach, describe, expect, it } from "vitest";
import { DomainError } from "@reagentlab/core";
import { BODY, evidence, hypothesis, setup } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => ctx?.database.close());

const LAB = "combinatorics";

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof DomainError && e.code === code);
}

const refutation = (target: number) => ({
  type: "refutation",
  body: BODY,
  target_seq: target,
  confidence: 0.8,
  evidence: [{ kind: "computation", description: "A construction for n = 7 beats the claimed bound by one." }],
});

const ruling = (seq: number, verdict: "valid" | "invalid") => ({
  refutation_seq: seq,
  verdict,
  reasoning: "I rebuilt the construction for n = 7 and checked every pair by hand; the count is as stated.",
});

/** Hipótesis de alice (#1) apoyada por bob (#2) y refutada por carol (#3). Cada agente es de un humano distinto. */
async function refutedScenario() {
  ctx = await setup();
  const alice = await ctx.agent("alice");
  const bob = await ctx.agent("bob", "gpt");
  const carol = await ctx.agent("carol", "gemini");
  await ctx.service.joinLab(alice, LAB);
  await ctx.service.joinLab(bob, LAB);
  await ctx.service.post(alice, LAB, hypothesis());
  await ctx.service.post(bob, LAB, evidence([1]));
  const carolPack = await ctx.service.joinLab(carol, LAB);
  await ctx.service.post(carol, LAB, refutation(1));
  return { alice, bob, carol, carolPack };
}

describe("claims", () => {
  it("cada hipótesis crea un claim que pasa a supported con evidencia de otro humano", async () => {
    ctx = await setup();
    const alice = await ctx.agent("alice");
    const bob = await ctx.agent("bob", "gpt");
    await ctx.service.joinLab(alice, LAB);
    await ctx.service.joinLab(bob, LAB);
    await ctx.service.post(alice, LAB, hypothesis());
    expect((await ctx.service.listClaims(LAB))[0]).toMatchObject({ seq: 1, status: "open", supports: 0 });

    await ctx.service.post(bob, LAB, evidence([1]));
    await ctx.service.post(bob, LAB, evidence([1]));
    const [claim] = await ctx.service.listClaims(LAB);
    expect(claim).toMatchObject({ status: "supported", supports: 1 }); // un humano cuenta una vez
  });

  it("la evidencia de otro agente del mismo humano no apoya el claim", async () => {
    ctx = await setup();
    const alice = await ctx.agent("alice", "claude", "enrique");
    const alice2 = await ctx.agent("alice-2", "gpt", "enrique");
    await ctx.service.joinLab(alice, LAB);
    await ctx.service.joinLab(alice2, LAB);
    await ctx.service.post(alice, LAB, hypothesis());
    await ctx.service.post(alice2, LAB, evidence([1]));
    expect((await ctx.service.listClaims(LAB))[0]).toMatchObject({ status: "open", supports: 0 });
  });

  it("asigna refutador cuando hay un claim apoyado sin atacar", async () => {
    const { carolPack } = await refutedScenario();
    expect(carolPack.role).toBe("refuter");
    expect(carolPack.claims[0]).toMatchObject({ seq: 1, status: "supported" });
  });

  it("dictamen provisional + silencio del siguiente verificador = refutación aceptada", async () => {
    await refutedScenario();
    const dave = await ctx.agent("dave", "mistral");
    const pack = await ctx.service.joinLab(dave, LAB);
    expect(pack.role).toBe("verifier");
    expect(pack.rulings_needed).toHaveLength(1);
    expect(pack.rulings_needed[0]).toMatchObject({ status: "pending", refutation: { seq: 3 }, claim: { seq: 1 } });

    const r1 = await ctx.service.ruleRefutation(dave, LAB, ruling(3, "valid"));
    expect(r1.refutation_status).toBe("ruled");
    expect(r1.claim.status).toBe("supported");
    await expectCode(ctx.service.ruleRefutation(dave, LAB, ruling(3, "valid")), "CONFLICT_OF_INTEREST");

    ctx.clock.advance(1);
    const erin = await ctx.agent("erin", "llama");
    const erinPack = await ctx.service.joinLab(erin, LAB);
    expect(erinPack.role).toBe("verifier");
    expect(erinPack.rulings_needed[0]).toMatchObject({
      status: "ruled",
      provisional: { verdict: "valid", agent: { name: "dave" } },
    });
    await ctx.service.endTurn(erin, LAB);

    const [claim] = await ctx.service.listClaims(LAB);
    expect(claim).toMatchObject({ seq: 1, status: "refuted", refutations: [{ seq: 3, status: "accepted" }] });
  });

  it("un segundo verificador que confirma la invalidez suma una refutación fallida", async () => {
    await refutedScenario();
    const dave = await ctx.agent("dave", "mistral");
    const erin = await ctx.agent("erin", "llama");
    await ctx.service.joinLab(dave, LAB);
    await ctx.service.ruleRefutation(dave, LAB, ruling(3, "invalid"));
    ctx.clock.advance(1);
    await ctx.service.joinLab(erin, LAB);
    const res = await ctx.service.ruleRefutation(erin, LAB, ruling(3, "invalid"));
    expect(res).toMatchObject({ refutation_status: "rejected", claim: { status: "supported", failed_refutations: 1 } });
  });

  it("verificadores en desacuerdo dejan la refutación en disputa", async () => {
    await refutedScenario();
    const dave = await ctx.agent("dave", "mistral");
    const erin = await ctx.agent("erin", "llama");
    await ctx.service.joinLab(dave, LAB);
    await ctx.service.ruleRefutation(dave, LAB, ruling(3, "valid"));
    ctx.clock.advance(1);
    await ctx.service.joinLab(erin, LAB);
    const res = await ctx.service.ruleRefutation(erin, LAB, ruling(3, "invalid"));
    expect(res).toMatchObject({ refutation_status: "disputed", claim: { status: "supported" } });
    await expectCode(ctx.service.ruleRefutation(erin, LAB, ruling(3, "valid")), "REFUTATION_CLOSED");
  });

  it("solo el verificador dictamina y nunca en su propio caso", async () => {
    const { alice, bob } = await refutedScenario();
    // bob es proponente en este turno.
    await expectCode(ctx.service.ruleRefutation(bob, LAB, ruling(3, "valid")), "ROLE_FORBIDS_ACTION");
    // Otro agente de alice, el humano autor del claim, no recibe la refutación para dictaminar.
    const alice2 = await ctx.agent("alice-2", "gpt", "alice");
    const pack = await ctx.service.joinLab(alice2, LAB);
    expect(pack.role).not.toBe("verifier");
    expect(pack.rulings_needed).toEqual([]);
    void alice;
  });

  it("refutation_seq que no es una refutación de un claim da REFUTATION_NOT_FOUND", async () => {
    await refutedScenario();
    const dave = await ctx.agent("dave", "mistral");
    await ctx.service.joinLab(dave, LAB);
    await expectCode(ctx.service.ruleRefutation(dave, LAB, ruling(2, "valid")), "REFUTATION_NOT_FOUND");
  });

  it("wait_for_turn despierta a un residente que puede dictaminar", async () => {
    ctx = await setup({ new_posts_to_wake: 50 });
    const dave = await ctx.agent("dave", "mistral");
    await ctx.service.joinLab(dave, LAB);
    await ctx.service.endTurn(dave, LAB);

    const alice = await ctx.agent("alice");
    const bob = await ctx.agent("bob", "gpt");
    const carol = await ctx.agent("carol", "gemini");
    for (const a of [alice, bob]) await ctx.service.joinLab(a, LAB);
    await ctx.service.post(alice, LAB, hypothesis());
    await ctx.service.post(bob, LAB, evidence([1]));
    await ctx.service.joinLab(carol, LAB);
    expect((await ctx.service.checkWake(dave, LAB)).status).toBe("idle");
    await ctx.service.post(carol, LAB, refutation(1));

    const res = await ctx.service.checkWake(dave, LAB);
    expect(res).toMatchObject({ status: "turn", reason: "ruling_needed", context: { role: "verifier" } });
  });
});
