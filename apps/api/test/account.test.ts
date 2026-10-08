import { type Database, createLab, ensureProblem, openDatabase } from "@reagentlab/db";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { COMBINATORICS_LAB, SEED_PROBLEMS } from "../src/seed.js";

const KEY = "test-service-key";
const NOW = new Date("2026-10-07T10:00:00Z");
const OLD = new Date("2020-01-01T00:00:00Z").toISOString();

let database: Database;
let app: FastifyInstance;

const svc = (userId?: string) => ({
  "x-reagent-service-key": KEY,
  ...(userId ? { "x-reagent-user": userId } : {}),
});

async function signIn(handle: string, createdAt = OLD) {
  const res = await app.inject({
    method: "POST",
    url: "/v1/account/users",
    headers: svc(),
    payload: { provider: "github", provider_id: `gh-${handle}`, handle, account_created_at: createdAt },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as { id: string; can_create_agents: boolean; reason?: string };
}

beforeAll(async () => {
  database = await openDatabase("pglite:memory");
  await database.migrate();
  await createLab(database.db, COMBINATORICS_LAB);
  await ensureProblem(database.db, COMBINATORICS_LAB.slug, SEED_PROBLEMS["erdos-problems"]![0]!);
  ({ app } = buildApp({
    db: database.db,
    tokenPepper: "p",
    webServiceKey: KEY,
    corsOrigins: ["http://web.test"],
    clock: { now: () => NOW },
  }));
});

afterAll(async () => {
  await app.close();
  await database.close();
});

describe("rutas de cuenta", () => {
  it("exigen la clave de servicio", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/account/me", headers: { "x-reagent-service-key": "nope" } });
    expect(res.statusCode).toBe(401);
  });

  it("el alta de agente devuelve un token que sirve en el MCP y en REST", async () => {
    const user = await signIn("ada");
    expect(user.can_create_agents).toBe(true);
    const res = await app.inject({
      method: "POST",
      url: "/v1/account/agents",
      headers: svc(user.id),
      payload: { name: "Ada's Claude", model_family: "claude" },
    });
    expect(res.statusCode).toBe(201);
    const { token, agent_id } = res.json();
    expect(token).toMatch(/^rl_ag_/);

    const join = await app.inject({
      method: "POST",
      url: `/v1/labs/${COMBINATORICS_LAB.slug}/join`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(join.statusCode).toBe(200);

    const turns = await app.inject({ method: "GET", url: `/v1/labs/${COMBINATORICS_LAB.slug}/turns` });
    expect(turns.json().turns).toEqual([
      expect.objectContaining({ agent: { name: "Ada's Claude", model_family: "claude" }, role: expect.any(String) }),
    ]);

    const list = (await app.inject({ method: "GET", url: "/v1/account/agents", headers: svc(user.id) })).json();
    expect(list.agents[0].id).toBe(agent_id);
    expect(JSON.stringify(list)).not.toContain(token);
  });

  it("rechaza cuentas de GitHub demasiado nuevas", async () => {
    const user = await signIn("newbie", new Date("2026-09-01T00:00:00Z").toISOString());
    expect(user.can_create_agents).toBe(false);
    const res = await app.inject({
      method: "POST",
      url: "/v1/account/agents",
      headers: svc(user.id),
      payload: { name: "x bot", model_family: "gpt" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("ACCOUNT_TOO_NEW");
  });

  it("limita a 3 agentes activos por humano; desactivar libera hueco y revoca tokens", async () => {
    const user = await signIn("grace");
    const ids: string[] = [];
    const tokens: string[] = [];
    for (const n of ["a1", "a2", "a3"]) {
      const r = await app.inject({
        method: "POST",
        url: "/v1/account/agents",
        headers: svc(user.id),
        payload: { name: n, model_family: "gemini" },
      });
      ids.push(r.json().agent_id);
      tokens.push(r.json().token);
    }
    const fourth = await app.inject({
      method: "POST",
      url: "/v1/account/agents",
      headers: svc(user.id),
      payload: { name: "a4", model_family: "gemini" },
    });
    expect(fourth.json().code).toBe("AGENT_LIMIT_REACHED");

    await app.inject({ method: "POST", url: `/v1/account/agents/${ids[0]}/disable`, headers: svc(user.id) });
    const denied = await app.inject({
      method: "POST",
      url: `/v1/labs/${COMBINATORICS_LAB.slug}/join`,
      headers: { authorization: `Bearer ${tokens[0]}` },
    });
    expect(denied.statusCode).toBe(401);
    const again = await app.inject({
      method: "POST",
      url: "/v1/account/agents",
      headers: svc(user.id),
      payload: { name: "a4", model_family: "gemini" },
    });
    expect(again.statusCode).toBe(201);
  });

  it("emite y revoca tokens solo de agentes propios", async () => {
    const owner = await signIn("owner");
    const other = await signIn("other");
    const created = (
      await app.inject({
        method: "POST",
        url: "/v1/account/agents",
        headers: svc(owner.id),
        payload: { name: "mine", model_family: "claude" },
      })
    ).json();
    const steal = await app.inject({
      method: "POST",
      url: `/v1/account/agents/${created.agent_id}/tokens`,
      headers: svc(other.id),
    });
    expect(steal.statusCode).toBe(404);

    const second = (
      await app.inject({ method: "POST", url: `/v1/account/agents/${created.agent_id}/tokens`, headers: svc(owner.id) })
    ).json();
    const revoke = await app.inject({
      method: "DELETE",
      url: `/v1/account/agents/${created.agent_id}/tokens/${second.token_info.id}`,
      headers: svc(owner.id),
    });
    expect(revoke.statusCode).toBe(200);
    const res = await app.inject({
      method: "POST",
      url: `/v1/labs/${COMBINATORICS_LAB.slug}/join`,
      headers: { authorization: `Bearer ${second.token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("CORS solo para la web y solo en lecturas públicas", async () => {
    const ok = await app.inject({ method: "GET", url: "/v1/labs", headers: { origin: "http://web.test" } });
    expect(ok.headers["access-control-allow-origin"]).toBe("http://web.test");
    const evil = await app.inject({ method: "GET", url: "/v1/labs", headers: { origin: "http://evil.test" } });
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
