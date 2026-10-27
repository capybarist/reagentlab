import { afterEach, describe, expect, it } from "vitest";
import { archiveEmptyHostProblem, ensureProblem } from "../src/index.js";
import { hypothesis, setup } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => ctx?.database.close());

const LAB = "combinatorics";
const STATEMENT =
  "A precise question: what is asked, what is already known with its source, and what would count as a conclusion of this thread.";

describe("tags y búsqueda de hilos (ADR-0038)", () => {
  it("los hilos llevan tags normalizados, la sala los cuenta y se buscan por texto y tag", async () => {
    ctx = await setup();
    const a = await ctx.agent("alice");
    const p1 = await ctx.service.proposeProblem({ userId: a.userId, agentId: a.agentId }, LAB, {
      title: "Ramsey number R(4,6) lower bound",
      statement: STATEMENT,
      answer_criteria: "A checkable argument or computation that settles the question as stated.",
      tags: ["#Ramsey Theory", "computation", "ramsey_theory"],
    });
    expect(p1.tags).toEqual(["ramsey-theory", "computation"]);
    await ctx.service.proposeProblem({ userId: a.userId, agentId: a.agentId }, LAB, {
      title: "Sunflower conjecture for three petals",
      statement: STATEMENT,
      answer_criteria: "A checkable argument or computation that settles the question as stated.",
      tags: ["set-systems", "Ramsey-Theory"],
    });

    expect(await ctx.service.labTags(LAB)).toEqual([
      { tag: "ramsey-theory", threads: 2 },
      { tag: "computation", threads: 1 },
      { tag: "set-systems", threads: 1 },
    ]);
    expect((await ctx.service.listProblems(LAB, ["active"], "#Set Systems")).map((p) => p.title)).toEqual([
      "Sunflower conjecture for three petals",
    ]);

    const byText = await ctx.service.searchThreads("sunflower");
    expect(byText.map((t) => [t.lab_slug, t.slug])).toEqual([[LAB, "sunflower-conjecture-for-three-petals"]]);
    expect((await ctx.service.searchThreads("", "ramsey-theory")).length).toBe(2);
    expect((await ctx.service.searchThreads("R(4,6)", "set-systems")).length).toBe(0);
    expect(await ctx.service.searchThreads("   ")).toEqual([]);
    // Los comodines de LIKE se buscan como texto.
    expect(await ctx.service.searchThreads("%")).toEqual([]);

    // Fusionar: ramsey-theory → ramsey, sin repetir si el hilo ya lo tenía.
    expect(await ctx.service.mergeTag(LAB, "ramsey-theory", "#Ramsey")).toBe(2);
    expect((await ctx.service.labTags(LAB)).map((t) => t.tag)).toEqual(["ramsey", "computation", "set-systems"]);

    const set = await ctx.service.setProblemTags(LAB, p1.slug, ["F1", "f1", "x"]);
    expect(set.tags).toEqual(["f1"]);
    const pack = await ctx.service.joinLab(a, LAB, p1.slug);
    expect(pack.problem.tags).toEqual(["f1"]);
    expect(pack.lab_tags.map((t) => t.tag)).toContain("ramsey");
  });

  it("el seed pone tags solo si el hilo no tiene y archiva hilos generales vacíos del host", async () => {
    ctx = await setup();
    await ensureProblem(ctx.db, LAB, { slug: "main", title: "Improve the bound", statement: STATEMENT, tags: ["bounds"] }, { refresh: true });
    expect((await ctx.service.getProblem(LAB, "main")).problem.tags).toEqual(["bounds"]);
    await ctx.service.setProblemTags(LAB, "main", ["combinatorics"]);
    await ensureProblem(ctx.db, LAB, { slug: "main", title: "Improve the bound", statement: STATEMENT, tags: ["bounds"] }, { refresh: true });
    expect((await ctx.service.getProblem(LAB, "main")).problem.tags).toEqual(["combinatorics"]);

    await ensureProblem(ctx.db, LAB, { slug: "broad", title: "Everything about bounds", statement: STATEMENT });
    expect(await archiveEmptyHostProblem(ctx.db, LAB, "broad")).toBe(true);
    expect(await archiveEmptyHostProblem(ctx.db, LAB, "broad")).toBe(false);

    // Con posts no se archiva.
    const a = await ctx.agent("alice");
    await ctx.service.joinLab(a, LAB, "main");
    await ctx.service.post(a, LAB, hypothesis());
    expect(await archiveEmptyHostProblem(ctx.db, LAB, "main")).toBe(false);
    expect((await ctx.service.listProblems(LAB)).map((p) => p.slug)).toEqual(["main"]);
  });
});
