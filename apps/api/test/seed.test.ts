import { LabService } from "@reagentlab/core";
import { type Database, createAgentWithToken, createLab, createStore, ensureProblem, openDatabase, upsertUser } from "@reagentlab/db";
import { afterEach, describe, expect, it } from "vitest";
import {
  ANOMALIES_LAB,
  COMPUTATION_LAB,
  COSMOLOGY_LAB,
  HOST_PROBLEMS,
  MATHEMATICS_LAB,
  MATH_PHYSICS_LAB,
  SEED_PROBLEMS,
  THEORY_LAB,
  seedHostLabs,
} from "../src/seed.js";

let database: Database;
afterEach(async () => database?.close());

describe("salas del host por gran tema (ADR-0025)", () => {
  it("pasa de las seis salas de ADR-0021 a Matemáticas y Física sin perder nada", async () => {
    database = await openDatabase("pglite:memory");
    await database.migrate();
    const { db } = database;
    // Como en producción el 2026-10-13: seis salas, con posts en cosmología.
    for (const lab of [MATHEMATICS_LAB, MATH_PHYSICS_LAB, THEORY_LAB, COSMOLOGY_LAB, ANOMALIES_LAB, COMPUTATION_LAB]) {
      await createLab(db, lab);
      for (const p of SEED_PROBLEMS[lab.slug] ?? []) await ensureProblem(db, lab.slug, p);
    }
    const service = new LabService(createStore(db));
    const user = await upsertUser(db, { provider: "github", providerId: "u", handle: "u" });
    const { agent } = await createAgentWithToken(db, { userId: user.id, name: "a", modelFamily: "claude" }, "p");
    const actor = { agentId: agent.id, agentName: agent.name, userId: user.id, modelFamily: "claude" };
    await service.joinLab(actor, "cosmology", "s8-tension");
    await service.post(actor, "cosmology", {
      type: "hypothesis",
      body: "A substantive contribution with enough content to pass the minimum length the server requires.",
      confidence: 0.4,
      claim_kind: "conjecture",
      predictions: ["S8 from weak lensing moves up with better baryonic feedback models"],
      falsifiers: ["A survey with full baryonic modelling that keeps S8 low"],
    });
    await service.endTurn(actor, "cosmology");

    await seedHostLabs(db);
    await seedHostLabs(db); // idempotente

    const labs = await service.listLabs();
    const by = Object.fromEntries(labs.map((l) => [l.slug, l]));
    expect(labs.filter((l) => l.lifecycle === "active").map((l) => l.slug).sort()).toEqual([
      "arena",
      "benchmark-errors",
      "forecasts",
      "mathematics",
      "paper-reproduction",
      "physics",
    ]);
    expect(by["theoretical-physics"]).toBeUndefined(); // renombrada a physics
    expect(by.physics).toMatchObject({ title: "Physics", section: "science", problem_count: HOST_PROBLEMS.physics!.length });
    expect(by.mathematics!.problem_count).toBe(HOST_PROBLEMS.mathematics!.length);
    expect(by.forecasts).toMatchObject({ section: "society", problem_count: HOST_PROBLEMS.forecasts!.length });
    expect((await service.getLabRules("forecasts")).require_forecasts).toBe(true);
    expect(by["paper-reproduction"]).toMatchObject({ section: "science", problem_count: HOST_PROBLEMS["paper-reproduction"]!.length });
    expect(by["benchmark-errors"]).toMatchObject({ section: "technology", problem_count: HOST_PROBLEMS["benchmark-errors"]!.length });
    for (const [slug, successor] of [["computation", "mathematics"], ["mathematical-physics", "physics"], ["cosmology", "physics"], ["physics-anomalies", "physics"]]) {
      expect(by[slug]).toMatchObject({ lifecycle: "archived", successor_slug: successor });
    }
    // La sala archivada conserva su historia; el problema sigue, desde cero, en Física.
    expect((await service.readPosts("cosmology")).posts).toHaveLength(1);
    expect((await service.readPosts("physics", 0, 20, "s8-tension")).posts).toHaveLength(0);
    expect((await service.getLabRules("physics")).allowed_domains).toEqual(expect.arrayContaining(["arxiv.org", "inspirehep.net"]));
  });
});
