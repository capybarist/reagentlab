import { createHash, randomBytes } from "node:crypto";
import { type Database, createAgentWithToken, openDatabase, upsertUser } from "@reagentlab/db";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

/** OAuth para MCP (ADR-0035): registro, consentimiento en la web, código con PKCE y token. */

const PEPPER = "oauth-pepper";
const KEY = "svc-key";
const ISSUER = "https://api.example.test";
const WEB = "https://web.example.test";
const REDIRECT = "https://client.example.test/callback";
let database: Database;
let app: FastifyInstance;

const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");

beforeAll(async () => {
  database = await openDatabase("pglite:memory");
  await database.migrate();
  ({ app } = buildApp({
    db: database.db,
    tokenPepper: PEPPER,
    webServiceKey: KEY,
    rateLimitPerMinute: 0,
    oauth: { issuer: ISSUER, webUrl: WEB },
  }));
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await database.close();
});

async function register(redirect_uris = [REDIRECT]) {
  return app.inject({ method: "POST", url: "/oauth/register", payload: { client_name: "Test client", redirect_uris } });
}

describe("OAuth para MCP (ADR-0035)", () => {
  it("publica los metadatos y /mcp sin token apunta a ellos", async () => {
    const pr = (await app.inject({ url: "/.well-known/oauth-protected-resource" })).json();
    expect(pr).toMatchObject({ resource: `${ISSUER}/mcp`, authorization_servers: [ISSUER] });
    const as = (await app.inject({ url: "/.well-known/oauth-authorization-server" })).json();
    expect(as).toMatchObject({
      issuer: ISSUER,
      token_endpoint: `${ISSUER}/oauth/token`,
      registration_endpoint: `${ISSUER}/oauth/register`,
      code_challenge_methods_supported: ["S256"],
    });
    const mcp = await app.inject({ method: "POST", url: "/mcp", payload: {} });
    expect(mcp.statusCode).toBe(401);
    expect(mcp.headers["www-authenticate"]).toContain(`resource_metadata="${ISSUER}/.well-known/oauth-protected-resource"`);
  });

  it("solo registra redirect_uri https o de localhost", async () => {
    expect((await register(["http://evil.example/cb"])).statusCode).toBe(400);
    expect((await register(["http://127.0.0.1:33418/callback"])).statusCode).toBe(201);
  });

  it("de punta a punta: el humano elige agente y el cliente recibe su token", async () => {
    const { client_id } = (await register()).json();
    const user = await upsertUser(database.db, { provider: "github", providerId: "u1", handle: "ada" });
    const { agent } = await createAgentWithToken(database.db, { userId: user.id, name: "lovelace", modelFamily: "claude" }, PEPPER);

    const params = {
      client_id,
      redirect_uri: REDIRECT,
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "xyz",
    };
    // Un redirect_uri ajeno no redirige a ninguna parte.
    const bad = await app.inject({ url: `/oauth/authorize?${new URLSearchParams({ ...params, redirect_uri: "https://evil.example/cb" })}` });
    expect(bad.statusCode).toBe(400);
    const auth = await app.inject({ url: `/oauth/authorize?${new URLSearchParams(params)}` });
    expect(auth.statusCode).toBe(302);
    expect(auth.headers.location).toMatch(new RegExp(`^${WEB}/oauth/authorize\\?`));

    const svc = { "x-reagent-service-key": KEY, "x-reagent-user": user.id };
    const client = (await app.inject({ url: `/v1/account/oauth/clients/${client_id}`, headers: svc })).json();
    expect(client).toMatchObject({ untrusted_name: "Test client", redirect_uris: [REDIRECT] });
    const approved = await app.inject({ method: "POST", url: "/v1/account/oauth/approve", headers: svc, payload: { ...params, agent_id: agent.id } });
    expect(approved.statusCode).toBe(200);
    const back = new URL(approved.json().redirect_to);
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get("state")).toBe("xyz");
    expect(back.searchParams.get("iss")).toBe(ISSUER);
    const code = back.searchParams.get("code")!;

    const exchange = (body: Record<string, string>) =>
      app.inject({
        method: "POST",
        url: "/oauth/token",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        payload: new URLSearchParams(body).toString(),
      });
    const base = { grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id };
    expect((await exchange({ ...base, code_verifier: "wrong-verifier-wrong-verifier-wrong-verifier" })).json()).toMatchObject({
      error: "invalid_grant",
    });
    // El código se gastó en el intento fallido: hace falta otro.
    const again = new URL(
      (await app.inject({ method: "POST", url: "/v1/account/oauth/approve", headers: svc, payload: { ...params, agent_id: agent.id } })).json()
        .redirect_to,
    ).searchParams.get("code")!;
    const ok = await exchange({ ...base, code: again, code_verifier: verifier });
    expect(ok.statusCode).toBe(200);
    const { access_token, token_type } = ok.json();
    expect(token_type).toBe("Bearer");
    expect(access_token).toMatch(/^rl_ag_/);
    expect((await exchange({ ...base, code: again, code_verifier: verifier })).json()).toMatchObject({ error: "invalid_grant" });

    // El token vale en /mcp como el de cualquier agente.
    const mcp = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: `Bearer ${access_token}`, accept: "application/json, text/event-stream", "content-type": "application/json" },
      payload: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    });
    expect(mcp.statusCode).toBe(200);
  });

  it("un agente de otro humano no se puede aprobar", async () => {
    const { client_id } = (await register()).json();
    const owner = await upsertUser(database.db, { provider: "github", providerId: "u2", handle: "owner" });
    const other = await upsertUser(database.db, { provider: "github", providerId: "u3", handle: "other" });
    const { agent } = await createAgentWithToken(database.db, { userId: owner.id, name: "mine", modelFamily: "gpt" }, PEPPER);
    const res = await app.inject({
      method: "POST",
      url: "/v1/account/oauth/approve",
      headers: { "x-reagent-service-key": KEY, "x-reagent-user": other.id },
      payload: {
        client_id,
        redirect_uri: REDIRECT,
        response_type: "code",
        code_challenge: challenge,
        code_challenge_method: "S256",
        agent_id: agent.id,
      },
    });
    expect(res.statusCode).toBe(404);
  });
});
