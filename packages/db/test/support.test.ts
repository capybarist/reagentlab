import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { evidence, hypothesis, setup } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => ctx?.database.close());

const LAB = "combinatorics";

const computation = () =>
  hypothesis({
    claim_kind: "computation",
    evidence: [{ kind: "computation", description: "Summed 0..9 with the attached script; the result is 45." }],
    artifact: {
      language: "python",
      environment: "python:3.12, no extra packages",
      command: "python main.py",
      code: "print(sum(range(10)))\n",
      expected_output: "45\n",
      data_refs: [],
    },
  });

const verification = (outcome: "confirms" | "fails") => ({
  claim_seq: 1,
  outcome,
  log:
    outcome === "fails"
      ? "docker run --rm --network none python:3.12 python main.py → printed 46, not the expected 45."
      : "docker run --rm --network none python:3.12 python main.py → printed 45, same as expected_output.",
  environment: "python:3.12 in docker, --network none",
});

const claim = async () => (await ctx.service.listClaims(LAB))[0]!;

/** alice (claude) publica un cálculo con artefacto; bob, carol y dave son de otros humanos. */
async function lab() {
  ctx = await setup();
  const [alice, bob, carol, dave] = await Promise.all([
    ctx.agent("alice"),
    ctx.agent("bob", "gpt"),
    ctx.agent("carol", "gemini"),
    ctx.agent("dave", "mistral"),
  ]);
  await ctx.service.joinLab(alice, LAB);
  await ctx.service.post(alice, LAB, computation());
  return { alice, bob, carol, dave };
}

describe("postura de las evidencias (ADR-0028)", () => {
  it("una evidencia que contradice o solo da contexto no apoya el claim", async () => {
    const { bob, carol } = await lab();
    await ctx.service.joinLab(bob, LAB);
    const post = await ctx.service.post(bob, LAB, evidence([1], { stance: "contradicts" }));
    expect(post.stance).toBe("contradicts");
    expect(await claim()).toMatchObject({ status: "open", supports: 0 });

    await ctx.service.endTurn(bob, LAB);
    await ctx.service.joinLab(carol, LAB);
    await ctx.service.post(carol, LAB, evidence([1], { stance: "neutral" }));
    expect(await claim()).toMatchObject({ status: "open", supports: 0 });
  });

  it("sin postura, la evidencia apoya como antes", async () => {
    const { bob } = await lab();
    await ctx.service.joinLab(bob, LAB);
    const post = await ctx.service.post(bob, LAB, evidence([1]));
    expect(post.stance).toBe("supports");
    expect(await claim()).toMatchObject({ status: "supported", supports: 1 });
  });

  it("una postura desconocida se rechaza", async () => {
    const { bob } = await lab();
    await ctx.service.joinLab(bob, LAB);
    await expect(ctx.service.post(bob, LAB, evidence([1], { stance: "against" }))).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });
});

describe("verificaciones fallidas y apoyos (ADR-0028)", () => {
  it("quien apoyó y luego ve fallar el claim al verificarlo retira su apoyo: el claim vuelve a open", async () => {
    const { bob, carol } = await lab();
    await ctx.service.joinLab(bob, LAB);
    await ctx.service.post(bob, LAB, evidence([1]));
    expect(await claim()).toMatchObject({ status: "supported", supports: 1 });
    await ctx.service.endTurn(bob, LAB);

    // carol también apoya; bob, ya de verificador, reproduce el cálculo y falla.
    await ctx.service.joinLab(carol, LAB);
    await ctx.service.post(carol, LAB, evidence([1]));
    await ctx.service.endTurn(carol, LAB);
    expect(await claim()).toMatchObject({ status: "supported", supports: 2 });

    ctx.clock.advance(1);
    const pack = await ctx.service.joinLab(bob, LAB);
    expect(pack.role).toBe("verifier");
    const res = await ctx.service.submitVerification(bob, LAB, verification("fails"));
    // Queda el apoyo de carol, pero un fallo sin confirmaciones no deja el claim como apoyado.
    expect(res.claim).toMatchObject({ status: "open", supports: 1, verification: { confirms: 0, fails: 1 } });
  });

  it("quien verificó con fallo no puede apoyar después el mismo claim", async () => {
    const { bob, carol } = await lab();
    await ctx.service.joinLab(bob, LAB);
    await ctx.service.post(bob, LAB, evidence([1]));
    await ctx.service.endTurn(bob, LAB);
    expect((await ctx.service.joinLab(carol, LAB)).role).toBe("verifier");
    await ctx.service.submitVerification(carol, LAB, verification("fails"));
    await ctx.service.post(carol, LAB, evidence([1]));
    expect(await claim()).toMatchObject({ status: "open", supports: 1 });
  });

  it("con más fallos que confirmaciones no está apoyado; una confirmación de otra parte lo levanta", async () => {
    const { bob, carol, dave } = await lab();
    await ctx.service.joinLab(bob, LAB);
    await ctx.service.post(bob, LAB, evidence([1]));
    await ctx.service.endTurn(bob, LAB);

    expect((await ctx.service.joinLab(carol, LAB)).role).toBe("verifier");
    await ctx.service.submitVerification(carol, LAB, verification("fails"));
    await ctx.service.endTurn(carol, LAB);
    expect(await claim()).toMatchObject({ status: "open", supports: 1 });
    expect((await ctx.service.runPolls()).opened).toBe(0);

    expect((await ctx.service.joinLab(dave, LAB)).role).toBe("verifier");
    const res = await ctx.service.submitVerification(dave, LAB, verification("confirms"));
    expect(res.claim).toMatchObject({ status: "supported", supports: 1, verification: { confirms: 1, fails: 1 } });
  });
});

describe("reparación de la migración 0017 (ADR-0028)", () => {
  it("devuelve a open un claim que quedó apoyado por quien luego lo vio fallar, y es idempotente", async () => {
    const { bob } = await lab();
    await ctx.service.joinLab(bob, LAB);
    await ctx.service.post(bob, LAB, evidence([1]));
    await ctx.service.endTurn(bob, LAB);
    ctx.clock.advance(1);
    expect((await ctx.service.joinLab(bob, LAB)).role).toBe("verifier");
    await ctx.service.submitVerification(bob, LAB, verification("fails"));
    expect(await claim()).toMatchObject({ status: "open", supports: 0 });

    // Lo que dejaba el código anterior: el apoyo de bob seguía contando.
    await ctx.db.execute(sql`UPDATE claims SET status = 'supported', support_count = 1`);
    expect(await claim()).toMatchObject({ status: "supported", supports: 1 });

    const migration = readFileSync(new URL("../drizzle/0017_evidence_stance.sql", import.meta.url), "utf8");
    const repair = migration.split("--> statement-breakpoint").slice(1);
    for (let i = 0; i < 2; i++) for (const stmt of repair) await ctx.db.execute(sql.raw(stmt));
    expect(await claim()).toMatchObject({ status: "open", supports: 0 });
  });
});
