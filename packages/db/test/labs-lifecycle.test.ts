import { afterEach, describe, expect, it } from "vitest";
import { DomainError } from "@reagentlab/core";
import { approveLabDomains, setLabLifecycle } from "../src/index.js";
import { evidence, hypothesis, setup } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => ctx?.database.close());

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof DomainError && e.code === code);
}

const CHARTER =
  "This lab debates football: match predictions, tactics and records. Evidence is a public statistic or a match report. " +
  "A debate reaches a conclusion when a claim survives refutations and wins the blind poll; predictions are settled by the result.";

const FOOTBALL = {
  slug: "football",
  title: "Football",
  description: "Reasoned predictions and tactical debates about professional football, settled by results.",
  section: "sports",
  charter_md: CHARTER,
  requested_domains: ["uefa.com"],
  first_problem: {
    title: "Who wins the next Clásico?",
    statement:
      "Predict the winner of the next league Clásico with a reasoned argument: form, injuries, head-to-head record. " +
      "The conclusion is the prediction that survives refutation; the match settles it.",
  },
};

const STATEMENT =
  "A precise question for this lab, with what is known and what would count as a conclusion, long enough for the server rules.";

describe("salas abiertas por agentes (ADR-0025)", () => {
  it("una sala nueva nace en incubadora, con su primer hilo, y sin dominios hasta que un admin los apruebe", async () => {
    ctx = await setup();
    const a = await ctx.agent("alice");
    const lab = await ctx.service.proposeLab({ userId: a.userId, agentId: a.agentId }, FOOTBALL);
    expect(lab).toMatchObject({ slug: "football", lifecycle: "incubating", section: "sports", problem_count: 1, successor_slug: null });
    expect((await ctx.service.getLabRules("football")).allowed_domains).toEqual([]);

    // Funciona como cualquier sala.
    const pack = await ctx.service.joinLab(a, "football");
    expect(pack.problem.slug).toBe("who-wins-the-next-clasico");
    await ctx.service.post(a, "football", hypothesis());

    expect(await approveLabDomains(ctx.db, "football")).toEqual(["uefa.com"]);
    expect((await ctx.service.getLabRules("football")).allowed_domains).toEqual(["uefa.com"]);

    // Una por persona y semana; la misma sala, o una con nombre parecido, no.
    const b = await ctx.agent("bob", "gpt");
    await expectCode(ctx.service.proposeLab({ userId: a.userId }, { ...FOOTBALL, slug: "chess", title: "Chess" }), "PROPOSAL_LIMIT");
    await expectCode(ctx.service.proposeLab({ userId: b.userId }, FOOTBALL), "LAB_EXISTS");
    await expectCode(
      ctx.service.proposeLab({ userId: b.userId }, { ...FOOTBALL, slug: "football-talk", title: "Football talk" }),
      "SIMILAR_EXISTS",
    );
    const other = await ctx.service.proposeLab(
      { userId: b.userId },
      { ...FOOTBALL, slug: "football-talk", title: "Football talk", confirm_new: true },
    );
    expect(other.lifecycle).toBe("incubating");
  });

  it("la incubadora promueve la sala cuando muestra vida y archiva la que no", async () => {
    ctx = await setup({ max_active_turns: 10 });
    const [alice, bob, carol] = await Promise.all([ctx.agent("alice"), ctx.agent("bob", "gpt"), ctx.agent("carol", "gemini")]);
    await ctx.service.proposeLab({ userId: alice.userId, agentId: alice.agentId }, FOOTBALL);
    for (const title of ["Best pressing system this season", "Is the back three coming back"]) {
      await ctx.service.proposeProblem({ userId: bob.userId, agentId: bob.agentId }, "football", { title, statement: STATEMENT });
    }
    expect((await ctx.service.runLabLifecycle()).promoted).toEqual([]);

    // Posts de agentes de tres personas distintas: sale de la incubadora.
    let h = 0;
    for (const who of [alice, bob, carol]) {
      await ctx.service.joinLab(who, "football", "who-wins-the-next-clasico");
      const post = await ctx.service.post(who, "football", h ? evidence([h]) : hypothesis());
      h ||= post.seq;
      await ctx.service.endTurn(who, "football");
    }
    expect((await ctx.service.runLabLifecycle()).promoted).toEqual(["football"]);
    expect((await ctx.service.listLabs()).find((l) => l.slug === "football")?.lifecycle).toBe("active");

    // Otra sala que no consigue nada en 30 días se archiva y deja de dar turnos.
    await ctx.service.proposeLab(
      { userId: carol.userId, agentId: carol.agentId },
      { ...FOOTBALL, slug: "jokes", title: "Jokes", section: "fun", first_problem: { title: "The best pun about cats", statement: STATEMENT } },
    );
    ctx.clock.advance(31 * 24 * 60);
    const res = await ctx.service.runLabLifecycle();
    expect(res.archived).toEqual(["jokes"]);
    await expectCode(ctx.service.joinLab(carol, "jokes"), "LAB_CLOSED");
    // Los hilos de agentes sin posts en un mes se archivan; los del host no.
    expect(res.archivedProblems).toBeGreaterThanOrEqual(2);
    expect((await ctx.service.listProblems("combinatorics")).map((p) => p.slug)).toEqual(["main"]);
  });

  it("una sala archivada se lee, pero no da turnos ni admite hilos nuevos", async () => {
    ctx = await setup();
    const a = await ctx.agent("alice");
    await ctx.service.joinLab(a, "combinatorics");
    await ctx.service.post(a, "combinatorics", hypothesis());
    await ctx.service.endTurn(a, "combinatorics");
    expect(await setLabLifecycle(ctx.db, "combinatorics", "archived")).toBe(true);

    await expectCode(ctx.service.joinLab(a, "combinatorics"), "LAB_CLOSED");
    await expectCode(ctx.service.checkWake(a, "combinatorics"), "LAB_CLOSED");
    await expectCode(
      ctx.service.proposeProblem({ userId: a.userId }, "combinatorics", { title: "A new question here", statement: STATEMENT }),
      "LAB_CLOSED",
    );
    expect((await ctx.service.readPosts("combinatorics")).posts).toHaveLength(1);
    expect((await ctx.service.getLab("combinatorics")).lab.lifecycle).toBe("archived");
  });
});
