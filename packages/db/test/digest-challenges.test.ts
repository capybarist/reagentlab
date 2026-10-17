import { afterEach, describe, expect, it } from "vitest";
import { DomainError } from "@reagentlab/core";
import { createStore } from "../src/index.js";
import { digestMd, hypothesis, setup } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => ctx?.database.close());

const LAB = "combinatorics";
const REASON =
  "The digest lists claim #1 as supported, but no other party has posted evidence for it yet; see posts #1 and after.";

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof DomainError && e.code === code);
}

/** bob propone (#1); alice es escriba y escribe el digest v1. */
async function withDigest() {
  ctx = await setup({ digest_stale_after_posts: 3 });
  const [alice, bob, carol, dave] = await Promise.all([
    ctx.agent("alice"),
    ctx.agent("bob", "gpt"),
    ctx.agent("carol", "gemini"),
    ctx.agent("dave", "llama"),
  ]);
  await ctx.service.joinLab(bob, LAB);
  await ctx.service.post(bob, LAB, hypothesis());
  await ctx.service.post(bob, LAB, hypothesis({ refs: [1] }));
  await ctx.service.post(bob, LAB, hypothesis({ refs: [2] }));
  await ctx.service.endTurn(bob, LAB);
  const pack = await ctx.service.joinLab(alice, LAB);
  expect(pack.role).toBe("scribe");
  await ctx.service.writeDigest(alice, LAB, { content_md: digestMd("Claim #1 is supported."), based_on_seq: 3 });
  await ctx.service.endTurn(alice, LAB);
  return { alice, bob, carol, dave };
}

describe("impugnación de digests (ADR-0037)", () => {
  it("aceptada: el escriba pierde reputación y el siguiente turno es un escriba que la ve", async () => {
    const { alice, bob, carol, dave } = await withDigest();

    const bobPack = await ctx.service.joinLab(bob, LAB);
    expect(bobPack.role).not.toBe("scribe");
    await expectCode(ctx.service.challengeDigest(bob, LAB, { version: 2, reason: REASON }), "DIGEST_INVALID");
    await expectCode(ctx.service.challengeDigest(bob, LAB, { version: 1, reason: "too short" }), "VALIDATION_FAILED");
    const c = await ctx.service.challengeDigest(bob, LAB, { version: 1, reason: REASON });
    expect(c).toMatchObject({ status: "pending", digest_version: 1, challenger: { name: "bob" } });
    await expectCode(ctx.service.challengeDigest(bob, LAB, { version: 1, reason: REASON }), "ALREADY_CHALLENGED");
    await ctx.service.endTurn(bob, LAB);

    // carol no es parte: le toca verificar y ve la impugnación.
    const carolPack = await ctx.service.joinLab(carol, LAB);
    expect(carolPack.role).toBe("verifier");
    expect(carolPack.digest_challenges.map((x) => x.id)).toEqual([c.id]);
    const ruled = await ctx.service.ruleDigestChallenge(carol, LAB, { challenge_id: c.id, verdict: "upheld", reasoning: REASON });
    expect(ruled).toMatchObject({ status: "upheld", ruling: { agent: { name: "carol" } } });
    await expectCode(
      ctx.service.ruleDigestChallenge(carol, LAB, { challenge_id: c.id, verdict: "rejected", reasoning: REASON }),
      "ALREADY_CHALLENGED",
    );
    await ctx.service.endTurn(carol, LAB);

    const rep = await ctx.service["store"].read((r) => r.getUserReputation(alice.userId));
    expect(rep).toBeLessThan(0);

    // El digest está impugnado: dave entra de escriba y ve qué corregir.
    const davePack = await ctx.service.joinLab(dave, LAB);
    expect(davePack.role).toBe("scribe");
    expect(davePack.digest).toMatchObject({ version: 1, challenged: true });
    expect(davePack.digest_challenges.map((x) => x.status)).toEqual(["upheld"]);
    await ctx.service.writeDigest(dave, LAB, { content_md: digestMd("Claim #1 is open."), based_on_seq: 3 });
    const detail = await ctx.service.getProblem(LAB, "main");
    expect(detail.digest).toMatchObject({ version: 2 });
    expect(detail.digest?.challenged).toBeUndefined();
    expect(detail.digest_challenges).toHaveLength(1);
  });

  it("nadie impugna su propio digest ni dictamina siendo parte; un digest nuevo deja sin objeto las pendientes", async () => {
    const { alice, bob, carol } = await withDigest();
    await ctx.service.joinLab(bob, LAB);
    const c = await ctx.service.challengeDigest(bob, LAB, { version: 1, reason: REASON });
    await ctx.service.endTurn(bob, LAB);

    // alice, autora del digest, no puede dictaminar aunque le toque verificar.
    const alicePack = await ctx.service.joinLab(alice, LAB);
    expect(alicePack.digest_challenges).toEqual([]);
    if (alicePack.role !== "scribe") {
      await expectCode(ctx.service.challengeDigest(alice, LAB, { version: 1, reason: REASON }), "CONFLICT_OF_INTEREST");
    }
    await ctx.service.endTurn(alice, LAB);

    // Un digest nuevo cierra la impugnación pendiente como superseded.
    await createStore(ctx.db).transaction(async (r) => {
      const lab = (await r.getLabBySlug(LAB))!;
      const problem = (await r.getProblem(lab.id, "main"))!;
      await r.supersedeDigestChallenges(problem.id, ctx.clock.now());
    });
    const list = await ctx.service.listDigestChallenges(LAB, "main");
    expect(list.map((x) => [x.id, x.status])).toEqual([[c.id, "superseded"]]);
    const carolPack = await ctx.service.joinLab(carol, LAB);
    expect(carolPack.digest_challenges).toEqual([]);
  });
});
