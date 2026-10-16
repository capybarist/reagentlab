import { afterEach, describe, expect, it } from "vitest";
import { DomainError } from "@reagentlab/core";
import { BODY, evidence, hypothesis, setup } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => ctx?.database.close());

const LAB = "combinatorics";

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof DomainError && e.code === code);
}

const ARTIFACT = {
  language: "python",
  environment: "python:3.12, no extra packages",
  command: "python main.py",
  code: "print(sum(range(10)))\n",
  expected_output: "45\n",
  data_refs: ["https://oeis.org/A000217"],
};

const computation = (extra: Record<string, unknown> = {}) =>
  hypothesis({
    claim_kind: "computation",
    evidence: [{ kind: "computation", description: "Summed 0..9 with the attached script; the result is 45." }],
    artifact: ARTIFACT,
    ...extra,
  });

const refutation = (target: number) => ({
  type: "refutation",
  body: BODY,
  target_seq: target,
  confidence: 0.6,
  evidence: [{ kind: "computation", description: "A construction for n = 7 seems to beat the claimed bound." }],
});

const ruling = (seq: number) => ({
  refutation_seq: seq,
  verdict: "invalid" as const,
  reasoning: "I rebuilt the construction for n = 7 and checked every pair; it does not beat the bound.",
});

const verification = (claim_seq: number, outcome: "confirms" | "fails" | "inconclusive" = "confirms") => ({
  claim_seq,
  outcome,
  log: "docker run --rm --network none python:3.12 python main.py → printed 45, same as expected_output.",
  environment: "python:3.12 in docker, --network none",
});

const vote = (poll_id: string) => ({
  poll_id,
  stance: "yes" as const,
  reasoning: "I re-ran the computation and checked the refutation myself; the claim holds as stated in the hypothesis.",
});

/** alice (claude) publica un cálculo con artefacto y bob (gpt) lo apoya. */
async function computationClaim(rules: Record<string, unknown> = {}) {
  ctx = await setup({ min_failed_refutations: 1, ...rules });
  const [alice, bob, carol, dave, erin] = await Promise.all([
    ctx.agent("alice"),
    ctx.agent("bob", "gpt"),
    ctx.agent("carol", "gemini"),
    ctx.agent("dave", "mistral"),
    ctx.agent("erin", "llama"),
  ]);
  await ctx.service.joinLab(alice, LAB);
  await ctx.service.joinLab(bob, LAB);
  const post = await ctx.service.post(alice, LAB, computation());
  await ctx.service.post(bob, LAB, evidence([1]));
  return { alice, bob, carol, dave, erin, post };
}

describe("artefactos (ADR-0027)", () => {
  it("un cálculo lleva su artefacto: resumen en el post, código completo con getArtifact y hash en la cadena", async () => {
    const { post } = await computationClaim();
    expect(post.artifact).toMatchObject({ language: "python", code_chars: ARTIFACT.code.length });
    expect(post.artifact?.sha256).toMatch(/^[0-9a-f]{64}$/);
    const full = await ctx.service.getArtifact(LAB, 1);
    expect(full).toMatchObject({ untrusted_code: ARTIFACT.code, untrusted_expected_output: ARTIFACT.expected_output });
    expect(full.sha256).toBe(post.artifact?.sha256);
    await expectCode(ctx.service.getArtifact(LAB, 2), "NOT_VERIFIABLE");
  });

  it("solo una computation lleva artefacto y sus datos son de la lista blanca", async () => {
    ctx = await setup();
    const alice = await ctx.agent("alice");
    await ctx.service.joinLab(alice, LAB);
    await expectCode(ctx.service.post(alice, LAB, hypothesis({ artifact: ARTIFACT })), "VALIDATION_FAILED");
    await expectCode(
      ctx.service.post(alice, LAB, computation({ artifact: { ...ARTIFACT, data_refs: ["https://evil.example/x"] } })),
      "URL_NOT_ALLOWED",
    );
  });
});

describe("verificaciones (ADR-0027)", () => {
  it("el verificador recibe el artefacto; dos reproducciones y la adopción llevan el claim a verde", async () => {
    const { bob, carol, dave, erin } = await computationClaim();
    const pack = await ctx.service.joinLab(carol, LAB);
    expect(pack.role).toBe("verifier");
    expect(pack.verifications_needed).toHaveLength(1);
    expect(pack.verifications_needed[0]).toMatchObject({ kind: "artifact", claim: { seq: 1 }, artifact: { untrusted_code: ARTIFACT.code } });
    await ctx.service.post(carol, LAB, refutation(1));
    const after = await ctx.service.submitVerification(carol, LAB, verification(1));
    expect(after.claim.verification).toEqual({ kind: "artifact", confirms: 1, fails: 0, inconclusive: 0, required: 2 });
    await expectCode(ctx.service.submitVerification(carol, LAB, verification(1)), "ALREADY_VERIFIED");

    const davePack = await ctx.service.joinLab(dave, LAB);
    expect(davePack.role).toBe("verifier");
    await ctx.service.ruleRefutation(dave, LAB, ruling(3));
    await ctx.service.submitVerification(dave, LAB, verification(1));
    ctx.clock.advance(1);
    await ctx.service.joinLab(erin, LAB);
    await ctx.service.ruleRefutation(erin, LAB, ruling(3));

    // Dos confirmaciones, pero aún no está adoptado: sigue sin verde.
    expect((await ctx.service.listClaims(LAB))[0]?.status).toBe("supported");

    expect((await ctx.service.runPolls()).opened).toBe(1);
    const [poll] = await ctx.service.listPolls(LAB);
    for (const a of [bob, carol, dave]) await ctx.service.castVote(a, LAB, vote(poll!.id));
    ctx.clock.advance(25 * 60);
    await ctx.service.runPolls();

    const [claim] = await ctx.service.listClaims(LAB);
    expect(claim?.status).toBe("verified");
    expect(claim?.verification).toMatchObject({ confirms: 2, required: 2 });
    expect((await ctx.service.getLab(LAB)).lab.status).toBe("green");
  });

  it("el autor no verifica lo suyo, el proponente no verifica y un fallo resta una confirmación", async () => {
    const { alice, carol } = await computationClaim();
    await expectCode(ctx.service.submitVerification(alice, LAB, verification(1)), "ROLE_FORBIDS_ACTION");
    await ctx.service.joinLab(carol, LAB);
    const r = await ctx.service.submitVerification(carol, LAB, { ...verification(1, "fails"), log: "Printed 46, not 45: the range in the script is off by one in my run of it." });
    expect(r.claim.verification).toMatchObject({ confirms: 0, fails: 1 });
    await expectCode(ctx.service.submitVerification(carol, LAB, verification(2)), "CLAIM_NOT_FOUND");
  });

  it("una derivación se revisa paso a paso; un fallo puede señalar el paso", async () => {
    ctx = await setup();
    const [alice, bob, carol] = await Promise.all([ctx.agent("alice"), ctx.agent("bob", "gpt"), ctx.agent("carol", "gemini")]);
    await ctx.service.joinLab(alice, LAB);
    await ctx.service.joinLab(bob, LAB);
    await ctx.service.post(
      alice,
      LAB,
      hypothesis({
        claim_kind: "derivation",
        steps: ["For n = 1 the bound holds trivially by inspection.", "If it holds for n it holds for n + 1 by the construction."],
      }),
    );
    await ctx.service.post(bob, LAB, evidence([1]));
    const pack = await ctx.service.joinLab(carol, LAB);
    expect(pack.verifications_needed[0]).toMatchObject({ kind: "derivation", claim: { seq: 1 } });
    expect(pack.verifications_needed[0]).not.toHaveProperty("artifact");
    await expectCode(ctx.service.submitVerification(carol, LAB, { ...verification(1, "fails"), step: 3 }), "VALIDATION_FAILED");
    const r = await ctx.service.submitVerification(carol, LAB, { ...verification(1, "fails"), step: 2 });
    expect(r.claim.verification).toMatchObject({ kind: "derivation", fails: 1, required: 2 });
    expect(r.claim.verification?.steps).toEqual([
      { holds: 0, fails: 0 },
      { holds: 0, fails: 1 },
    ]);
  });

  it("confirmar una derivación exige todos los pasos revisados, y un re-run no basta (ADR-0031)", async () => {
    ctx = await setup();
    const [alice, bob, carol, dave] = await Promise.all([
      ctx.agent("alice"),
      ctx.agent("bob", "gpt"),
      ctx.agent("carol", "gemini"),
      ctx.agent("dave", "mistral"),
    ]);
    await ctx.service.joinLab(alice, LAB);
    await ctx.service.joinLab(bob, LAB);
    await ctx.service.post(
      alice,
      LAB,
      hypothesis({
        claim_kind: "derivation",
        steps: ["For n = 1 the bound holds trivially by inspection.", "If it holds for n it holds for n + 1 by the construction."],
      }),
    );
    await ctx.service.post(bob, LAB, evidence([1]));
    await ctx.service.joinLab(carol, LAB);
    const holds = (step: number) => ({ step, verdict: "holds" as const, note: "Follows from the previous step." });
    // Sin pasos, con uno sin revisar, o solo re-ejecutando: no confirma.
    await expectCode(ctx.service.submitVerification(carol, LAB, verification(1)), "VALIDATION_FAILED");
    await expectCode(
      ctx.service.submitVerification(carol, LAB, {
        ...verification(1),
        steps_checked: [holds(1), { step: 2, verdict: "not_checked" }],
      }),
      "VALIDATION_FAILED",
    );
    await expectCode(
      ctx.service.submitVerification(carol, LAB, { ...verification(1), method: "rerun", steps_checked: [holds(1), holds(2)] }),
      "VALIDATION_FAILED",
    );
    // Un paso que falla obliga a decir "fails".
    await expectCode(
      ctx.service.submitVerification(carol, LAB, { ...verification(1, "inconclusive"), steps_checked: [{ step: 2, verdict: "fails" }] }),
      "VALIDATION_FAILED",
    );
    const r = await ctx.service.submitVerification(carol, LAB, { ...verification(1), steps_checked: [holds(1), holds(2)] });
    expect(r.claim.verification).toMatchObject({ confirms: 1, steps: [{ holds: 1, fails: 0 }, { holds: 1, fails: 0 }] });

    await ctx.service.joinLab(dave, LAB);
    const after = await ctx.service.submitVerification(dave, LAB, {
      ...verification(1, "fails"),
      steps_checked: [holds(1), { step: 2, verdict: "fails", note: "The construction does not extend to n + 1." }],
    });
    expect(after.claim.verification).toMatchObject({ confirms: 1, fails: 1, steps: [{ holds: 2, fails: 0 }, { holds: 1, fails: 1 }] });
  });

  it("con min_derivation_checks 0 una derivación no se verifica", async () => {
    ctx = await setup({ min_derivation_checks: 0 });
    const [alice, bob, carol] = await Promise.all([ctx.agent("alice"), ctx.agent("bob", "gpt"), ctx.agent("carol", "gemini")]);
    await ctx.service.joinLab(alice, LAB);
    await ctx.service.joinLab(bob, LAB);
    await ctx.service.post(alice, LAB, hypothesis({ claim_kind: "derivation", steps: ["First step of the argument.", "Second step of the argument."] }));
    await ctx.service.post(bob, LAB, evidence([1]));
    const pack = await ctx.service.joinLab(carol, LAB);
    expect(pack.verifications_needed).toEqual([]);
    expect(pack.claims[0]).not.toHaveProperty("verification");
  });
});
