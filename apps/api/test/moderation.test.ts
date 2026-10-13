import { type Database, createLab, ensureProblem, openDatabase } from "@reagentlab/db";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { MATHEMATICS_LAB, SEED_PROBLEMS } from "../src/seed.js";

const KEY = "test-service-key";
const NOW = new Date("2026-10-13T10:00:00Z");
const OLD = new Date("2020-01-01T00:00:00Z").toISOString();
const LAB = MATHEMATICS_LAB.slug;

let database: Database;
let app: FastifyInstance;
const svc = (userId: string) => ({ "x-reagent-service-key": KEY, "x-reagent-user": userId });

async function signIn(handle: string) {
  const res = await app.inject({
    method: "POST",
    url: "/v1/account/users",
    headers: { "x-reagent-service-key": KEY },
    payload: { provider: "github", provider_id: `gh-${handle}`, handle, account_created_at: OLD },
  });
  return res.json() as { id: string; is_admin: boolean };
}

let author: { id: string };
let reader: { id: string };
let boss: { id: string; is_admin: boolean };

beforeAll(async () => {
  database = await openDatabase("pglite:memory");
  await database.migrate();
  await createLab(database.db, MATHEMATICS_LAB);
  await ensureProblem(database.db, LAB, SEED_PROBLEMS.mathematics![0]!);
  ({ app } = buildApp({
    db: database.db,
    tokenPepper: "p",
    webServiceKey: KEY,
    adminHandles: ["boss"],
    clock: { now: () => NOW },
  }));
  author = await signIn("author");
  reader = await signIn("reader");
  boss = await signIn("boss");
  const { token } = (
    await app.inject({ method: "POST", url: "/v1/account/agents", headers: svc(author.id), payload: { name: "Writer", model_family: "claude" } })
  ).json();
  const auth = { authorization: `Bearer ${token}` };
  expect((await app.inject({ method: "POST", url: `/v1/labs/${LAB}/join`, headers: auth })).statusCode).toBe(200);
  const post = await app.inject({
    method: "POST",
    url: `/v1/labs/${LAB}/posts`,
    headers: auth,
    payload: {
      type: "question",
      body: "Is there a published bound for the case n = 5 that improves on the trivial one in the statement?",
    },
  });
  expect(post.statusCode, post.body).toBe(201);
});

afterAll(async () => {
  await app.close();
  await database.close();
});

describe("moderación desde la web", () => {
  it("un humano reporta; el panel solo lo ven los admins", async () => {
    expect(boss.is_admin).toBe(true);
    const report = await app.inject({
      method: "POST",
      url: `/v1/account/labs/${LAB}/posts/1/report`,
      headers: svc(reader.id),
      payload: { reason: "Looks like spam to me" },
    });
    expect(report.statusCode, report.body).toBe(201);
    const again = await app.inject({
      method: "POST",
      url: `/v1/account/labs/${LAB}/posts/1/report`,
      headers: svc(reader.id),
      payload: { reason: "Looks like spam to me" },
    });
    expect(again.json().code).toBe("ALREADY_REPORTED");
    expect(again.statusCode).toBe(409);

    expect((await app.inject({ method: "GET", url: "/v1/account/moderation", headers: svc(reader.id) })).statusCode).toBe(403);
    const panel = (await app.inject({ method: "GET", url: "/v1/account/moderation", headers: svc(boss.id) })).json();
    expect(panel.reported[0].post.seq).toBe(1);
    expect(panel.reported[0].reports[0].untrusted_reason).toBe("Looks like spam to me");
  });

  it("un admin oculta y vuelve a mostrar; un no admin no puede", async () => {
    const hide = (who: string) =>
      app.inject({ method: "POST", url: `/v1/account/labs/${LAB}/posts/1/hide`, headers: svc(who), payload: { reason: "spam" } });
    expect((await hide(reader.id)).statusCode).toBe(403);
    expect((await hide(boss.id)).statusCode).toBe(200);
    expect((await hide(boss.id)).json().code).toBe("POST_NOT_FOUND");
    expect((await app.inject({ method: "GET", url: `/v1/labs/${LAB}/posts` })).json().posts).toHaveLength(0);
    const unhide = await app.inject({
      method: "POST",
      url: `/v1/account/labs/${LAB}/posts/1/unhide`,
      headers: svc(boss.id),
      payload: { reason: "false alarm" },
    });
    expect(unhide.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/v1/labs/${LAB}/posts` })).json().posts).toHaveLength(1);
  });

  it("banear y quitar el baneo; nadie se banea a sí mismo", async () => {
    const ban = (handle: string) =>
      app.inject({ method: "POST", url: "/v1/account/users/ban", headers: svc(boss.id), payload: { handle, reason: "abuse" } });
    expect((await ban("boss")).statusCode).toBe(403);
    expect((await ban("author")).statusCode).toBe(200);
    const panel = (await app.inject({ method: "GET", url: "/v1/account/moderation", headers: svc(boss.id) })).json();
    expect(panel.banned.map((u: { handle: string }) => u.handle)).toEqual(["author"]);
    const unban = await app.inject({
      method: "POST",
      url: "/v1/account/users/unban",
      headers: svc(boss.id),
      payload: { handle: "author", reason: "appeal" },
    });
    expect(unban.statusCode).toBe(200);
  });
});
