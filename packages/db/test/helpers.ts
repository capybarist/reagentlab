import { LabService, type Actor, type Clock } from "@reagentlab/core";
import { DIGEST_SECTIONS } from "@reagentlab/contracts";
import { createAgentWithToken, createLab, createStore, openDatabase, upsertUser } from "../src/index.js";

export const PEPPER = "test-pepper";

export class FakeClock implements Clock {
  constructor(public t = new Date("2026-10-06T10:00:00Z")) {}
  now() {
    return new Date(this.t);
  }
  advance(minutes: number) {
    this.t = new Date(this.t.getTime() + minutes * 60_000);
  }
}

export const digestMd = (state: string) =>
  DIGEST_SECTIONS.map((s) => `${s}\n\n${s === "## Current state" ? state : "Nothing yet."}`).join("\n\n") +
  "\n\n" +
  "Padding so the digest reaches the minimum length required by the server for a real summary. ".repeat(2);

export async function setup(rules: Record<string, unknown> = {}) {
  const database = await openDatabase("pglite:memory");
  await database.migrate();
  const { db } = database;
  const clock = new FakeClock();
  const service = new LabService(createStore(db), clock);
  await createLab(db, {
    slug: "combinatorics",
    title: "Combinatorics: bounds",
    description: "Improve known bounds with constructions that code can verify.",
    rules: { allowed_domains: ["arxiv.org", "oeis.org"], ...rules },
    initialDigestMd: digestMd("Problem statement written by the host."),
  });

  async function agent(name: string, modelFamily = "claude", handle = name): Promise<Actor & { token: string }> {
    const user = await upsertUser(db, { provider: "github", providerId: `id-${handle}`, handle });
    const { agent, token } = await createAgentWithToken(db, { userId: user.id, name, modelFamily }, PEPPER);
    return { agentId: agent.id, agentName: agent.name, userId: user.id, modelFamily, token };
  }

  return { database, db, clock, service, agent };
}

export const BODY =
  "A substantive contribution with enough content to pass the minimum length the server requires.";

export const hypothesis = (extra: Record<string, unknown> = {}) => ({
  type: "hypothesis",
  body: BODY,
  confidence: 0.4,
  claim_kind: "conjecture",
  predictions: ["The bound holds for every n up to 40"],
  falsifiers: ["A construction for some n <= 40 that beats the bound"],
  ...extra,
});

export const evidence = (refs: number[], extra: Record<string, unknown> = {}) => ({
  type: "evidence",
  body: BODY,
  refs,
  confidence: 0.7,
  evidence: [{ kind: "computation", description: "Exhaustive search for n <= 12 finds no counterexample." }],
  ...extra,
});
