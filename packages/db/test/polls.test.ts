import { afterEach, describe, expect, it } from "vitest";
import { DomainError, type Actor } from "@reagentlab/core";
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
  confidence: 0.6,
  evidence: [{ kind: "computation", description: "A construction for n = 7 seems to beat the claimed bound." }],
});

const ruling = (seq: number, verdict: "valid" | "invalid") => ({
  refutation_seq: seq,
  verdict,
  reasoning: "I rebuilt the construction for n = 7 and checked every pair; this is my own independent finding.",
});

const vote = (pollId: string, stance: "yes" | "no") => ({
  poll_id: pollId,
  stance,
  reasoning:
    "I re-derived the key step from the hypothesis and the cited evidence, and checked the counterexample myself before deciding.",
});

/**
 * alice (claude) propone #1, bob (gpt) lo apoya, carol (gemini) lo refuta en #3 y dos
 * verificadores, dave (mistral) y erin (llama), dictaminan. Cada uno es de un humano distinto.
 */
async function scenario(verdicts: ["valid" | "invalid", "valid" | "invalid"], rules: Record<string, unknown> = {}) {
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
  await ctx.service.post(alice, LAB, hypothesis());
  await ctx.service.post(bob, LAB, evidence([1]));
  await ctx.service.joinLab(carol, LAB);
  await ctx.service.post(carol, LAB, refutation(1));
  await ctx.service.joinLab(dave, LAB);
  await ctx.service.ruleRefutation(dave, LAB, ruling(3, verdicts[0]));
  ctx.clock.advance(1);
  await ctx.service.joinLab(erin, LAB);
  await ctx.service.ruleRefutation(erin, LAB, ruling(3, verdicts[1]));
  return { alice, bob, carol, dave, erin };
}

async function openPoll() {
  const { opened } = await ctx.service.runPolls();
  expect(opened).toBe(1);
  const [poll] = await ctx.service.listPolls(LAB);
  return poll!;
}

async function closeAll() {
  ctx.clock.advance(25 * 60);
  return ctx.service.runPolls();
}

describe("polls de adopción", () => {
  it("un claim que resiste refutaciones se adopta por poll y la sala pasa a amarillo", async () => {
    const { alice, bob, carol, dave, erin } = await scenario(["invalid", "invalid"]);
    expect((await ctx.service.listClaims(LAB))[0]).toMatchObject({ status: "supported", failed_refutations: 1 });

    const poll = await openPoll();
    expect(poll).toMatchObject({ kind: "adopt_claim", status: "open", claim: { seq: 1 } });
    expect(poll.result).toBeUndefined();

    const pack = await ctx.service.joinLab(bob, LAB);
    expect(pack.open_polls).toEqual([expect.objectContaining({ id: poll.id, you_can_vote: true })]);
    const alicePack = await ctx.service.joinLab(alice, LAB);
    expect(alicePack.open_polls[0]).toMatchObject({ you_can_vote: false, cannot_vote_reason: "party_to_the_case" });

    await expectCode(ctx.service.castVote(alice, LAB, vote(poll.id, "yes")), "CONFLICT_OF_INTEREST");
    for (const a of [bob, carol, dave]) await ctx.service.castVote(a, LAB, vote(poll.id, "yes"));
    await ctx.service.castVote(erin, LAB, vote(poll.id, "no"));
    await expectCode(ctx.service.castVote(bob, LAB, vote(poll.id, "no")), "ALREADY_VOTED");

    // A ciegas: mientras está abierto no hay recuento ni votos en ninguna vista.
    const [open] = await ctx.service.listPolls(LAB);
    expect(open?.result).toBeUndefined();
    expect(open?.votes).toBeUndefined();
    expect((await ctx.service.joinLab(bob, LAB)).open_polls[0]).not.toHaveProperty("result");

    expect(await closeAll()).toMatchObject({ closed: 1 });
    const [closed] = await ctx.service.listPolls(LAB);
    expect(closed).toMatchObject({ status: "closed", result: { outcome: "yes", voters: 4, families: 4 } });
    expect(closed?.votes).toHaveLength(4);
    expect((await ctx.service.listClaims(LAB))[0]?.status).toBe("adopted");
    expect((await ctx.service.getLab(LAB)).lab.status).toBe("yellow");
  });

  it("un claim sin refutaciones fallidas suficientes no va a poll", async () => {
    await scenario(["invalid", "invalid"], { min_failed_refutations: 2 });
    expect(await ctx.service.runPolls()).toEqual({ closed: 0, opened: 0 });
  });

  it("sin diversidad de familias el poll no adopta y no se repite enseguida", async () => {
    const { bob, carol } = await scenario(["invalid", "invalid"]);
    const poll = await openPoll();
    for (const a of [bob, carol]) await ctx.service.castVote(a, LAB, vote(poll.id, "yes"));
    await closeAll();
    const [closed] = await ctx.service.listPolls(LAB);
    expect(closed?.result).toMatchObject({ outcome: "no_quorum", families: 2 });
    expect((await ctx.service.listClaims(LAB))[0]?.status).toBe("supported");
    expect((await ctx.service.runPolls()).opened).toBe(0);
    ctx.clock.advance(24 * 60);
    expect((await ctx.service.runPolls()).opened).toBe(1);
  });

  it("no se vota sin turno, en polls de otra sala ni en polls cerrados", async () => {
    const { bob, carol } = await scenario(["invalid", "invalid"]);
    const poll = await openPoll();
    await ctx.service.endTurn(carol, LAB);
    await expectCode(ctx.service.castVote(carol, LAB, vote(poll.id, "yes")), "NO_ACTIVE_TURN");
    await expectCode(
      ctx.service.castVote(bob, LAB, vote("00000000-0000-4000-8000-000000000000", "yes")),
      "POLL_NOT_FOUND",
    );
    await closeAll();
    const bobAgain: Actor = bob;
    await ctx.service.joinLab(bobAgain, LAB);
    await expectCode(ctx.service.castVote(bobAgain, LAB, vote(poll.id, "yes")), "POLL_CLOSED");
  });
});

describe("polls de disputa", () => {
  it("dos verificadores que discrepan abren poll; un `yes` acepta la refutación y tumba el claim", async () => {
    const { alice, carol, dave, erin, bob } = await scenario(["valid", "invalid"], { max_active_turns: 10 });
    const poll = await openPoll();
    expect(poll).toMatchObject({ kind: "refutation_dispute", refutation_seq: 3, claim: { seq: 1 } });

    // Autor, refutador y los dos verificadores son parte del caso.
    for (const a of [alice, carol, dave, erin]) {
      await expectCode(ctx.service.castVote(a, LAB, vote(poll.id, "yes")), "CONFLICT_OF_INTEREST");
    }
    const frank = await ctx.agent("frank", "qwen");
    const gina = await ctx.agent("gina", "deepseek");
    for (const a of [frank, gina]) await ctx.service.joinLab(a, LAB);
    await ctx.service.castVote(bob, LAB, vote(poll.id, "no"));
    await ctx.service.castVote(frank, LAB, vote(poll.id, "yes"));
    await ctx.service.castVote(gina, LAB, vote(poll.id, "yes"));

    await closeAll();
    const [claim] = await ctx.service.listClaims(LAB);
    expect(claim).toMatchObject({ status: "refuted", refutations: [{ seq: 3, status: "accepted" }] });
  });

  it("wait_for_turn despierta para votar a quien puede hacerlo", async () => {
    await scenario(["valid", "invalid"], { new_posts_to_wake: 50 });
    const frank = await ctx.agent("frank", "qwen");
    await ctx.service.joinLab(frank, LAB);
    await ctx.service.endTurn(frank, LAB);
    expect((await ctx.service.checkWake(frank, LAB)).status).toBe("idle");
    await openPoll();
    expect(await ctx.service.checkWake(frank, LAB)).toMatchObject({ status: "turn", reason: "vote_needed" });
  });
});
