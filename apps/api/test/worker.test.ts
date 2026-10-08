import { LabService } from "@reagentlab/core";
import { type Database, createAgentWithToken, createLab, ensureProblem, createStore, openDatabase, schema, upsertUser } from "@reagentlab/db";
import { afterEach, describe, expect, it } from "vitest";
import { LabEventsHub } from "../src/lab-events.js";
import { type Worker, startWorker } from "../src/worker.js";
import { COMBINATORICS_LAB, SEED_PROBLEMS } from "../src/seed.js";

let database: Database;
let worker: Worker | undefined;
let hub: LabEventsHub | undefined;

afterEach(async () => {
  await worker?.stop();
  await hub?.close();
  await database?.close();
  worker = hub = undefined;
});

async function setup() {
  database = await openDatabase("pglite:memory");
  await database.migrate();
  await createLab(database.db, COMBINATORICS_LAB);
  await ensureProblem(database.db, COMBINATORICS_LAB.slug, SEED_PROBLEMS["erdos-problems"]![0]!);
  const user = await upsertUser(database.db, { provider: "github", providerId: "w", handle: "w" });
  const { agent } = await createAgentWithToken(database.db, { userId: user.id, name: "w", modelFamily: "claude" }, "p");
  const actor = { agentId: agent.id, agentName: agent.name, userId: user.id, modelFamily: "claude" };
  return { actor };
}

async function until(check: () => Promise<boolean>, ms = 15_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("timeout");
}

describe("worker con pg-boss sobre PGlite", () => {
  it("expira los turnos vencidos cuando corre el trabajo", async () => {
    const { actor } = await setup();
    let now = new Date();
    const service = new LabService(createStore(database.db), { now: () => now });
    await service.joinLab(actor, COMBINATORICS_LAB.slug);
    now = new Date(now.getTime() + 31 * 60_000);

    worker = await startWorker(database, service, { pollingIntervalSeconds: 0.5 });
    await worker.runNow("expire-turns");
    await until(async () => {
      const turns = await database.db.select().from(schema.turns);
      return turns.every((t) => t.status === "expired");
    });
  });
});

describe("LISTEN/NOTIFY", () => {
  it("cada evento público de una sala despierta a quien espera en ella", async () => {
    const { actor } = await setup();
    hub = await LabEventsHub.start(database);
    const service = new LabService(createStore(database.db));

    const started = Date.now();
    const woke = hub.next(COMBINATORICS_LAB.slug, 10_000);
    await service.joinLab(actor, COMBINATORICS_LAB.slug); // emite turn.started
    await woke;
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("vence el plazo si no pasa nada y respeta el abort", async () => {
    await setup();
    hub = await LabEventsHub.start(database);
    const t0 = Date.now();
    await hub.next("otra-sala", 300);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(250);
    const abort = new AbortController();
    const p = hub.next("otra-sala", 10_000, abort.signal);
    abort.abort();
    await p;
  });
});
