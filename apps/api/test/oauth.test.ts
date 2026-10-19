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

  it("registra clientes que piden client_secret_basic, como Gemini", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/oauth/register",
      payload: {
        // Lo que manda la app de Gemini: seis relés de Google y client_secret_post.
        client_name: "Google",
        redirect_uris: ["oauth-redirect", "oauth-redirect-test", "oauth-redirect-sandbox"].flatMap((host) =>
          ["r", "a"].map((p) => `https://${host}.googleusercontent.com/${p}/user_bound_custom-mcp-123-api.example`),
        ),
        response_types: ["code"],
        token_endpoint_auth_method: "client_secret_post",
        grant_types: ["authorization_code", "refresh_token"],
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ token_endpoint_auth_method: "client_secret_post", client_secret: expect.any(String) });
    const { client_id, client_secret, redirect_uris } = res.json();
    const redirect = redirect_uris[0] as string;

    // Sin PKCE: vale para este cliente porque es confidencial; un cliente público se rechaza.
    const params = { client_id, redirect_uri: redirect, response_type: "code", state: "g" };
    const auth = await app.inject({ url: `/oauth/authorize?${new URLSearchParams(params)}` });
    expect(auth.headers.location).toMatch(new RegExp(`^${WEB}/oauth/authorize\\?`));
    // Google manda un state largo y puede mandar PKCE "plain": no se rechaza a un cliente confidencial.
    const longState = "s".repeat(3000);
    const plain = await app.inject({
      url: `/oauth/authorize?${new URLSearchParams({ ...params, state: longState, code_challenge: "abc", code_challenge_method: "plain" })}`,
    });
    const toWeb = new URL(plain.headers.location as string);
    expect(toWeb.origin + toWeb.pathname).toBe(`${WEB}/oauth/authorize`);
    expect(toWeb.searchParams.get("state")).toBe(longState);
    expect(toWeb.searchParams.get("code_challenge")).toBeNull();
    const pub = (await register()).json();
    const pubAuth = await app.inject({ url: `/oauth/authorize?${new URLSearchParams({ ...params, client_id: pub.client_id, redirect_uri: REDIRECT })}` });
    expect(new URL(pubAuth.headers.location as string).searchParams.get("error")).toBe("invalid_request");

    const user = await upsertUser(database.db, { provider: "github", providerId: "g1", handle: "gem" });
    const { agent } = await createAgentWithToken(database.db, { userId: user.id, name: "plank", modelFamily: "gemini" }, PEPPER);
    const svc = { "x-reagent-service-key": KEY, "x-reagent-user": user.id };
    const approve = async () =>
      new URL((await app.inject({ method: "POST", url: "/v1/account/oauth/approve", headers: svc, payload: { ...params, agent_id: agent.id } })).json().redirect_to)
        .searchParams.get("code")!;
    const exchange = (body: Record<string, string>) =>
      app.inject({
        method: "POST",
        url: "/oauth/token",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        payload: new URLSearchParams({ grant_type: "authorization_code", redirect_uri: redirect, client_id, ...body }).toString(),
      });
    expect((await exchange({ code: await approve(), client_secret: "wrong" })).statusCode).toBe(401);
    expect((await exchange({ code: await approve() })).json()).toMatchObject({ error: "invalid_grant" });
    const ok = await exchange({ code: await approve(), client_secret });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().access_token).toMatch(/^rl_ag_/);
    expect(ok.json()).toMatchObject({ refresh_token: ok.json().access_token, expires_in: expect.any(Number) });

    // Renovar devuelve el mismo token mientras siga vigente.
    const refresh = (body: Record<string, string>) =>
      app.inject({
        method: "POST",
        url: "/oauth/token",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        payload: new URLSearchParams({ grant_type: "refresh_token", client_id, client_secret, ...body }).toString(),
      });
    expect((await refresh({ refresh_token: ok.json().refresh_token })).json().access_token).toBe(ok.json().access_token);
    expect((await refresh({ refresh_token: "rl_ag_00000000_nope" })).json()).toMatchObject({ error: "invalid_grant" });

    // Gemini habla con /mcp/ y solo acepta application/json: no debe recibir 406.
    const mcp = await app.inject({
      method: "POST",
      url: "/mcp/",
      headers: { authorization: `Bearer ${ok.json().access_token}`, accept: "application/json", "content-type": "application/json" },
      payload: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    });
    expect(mcp.statusCode).toBe(200);
    // Gemini solo entiende un subconjunto de JSON Schema: nada de tuplas (`items` como array).
    const tools = mcp.json().result.tools as { name: string; inputSchema: unknown }[];
    expect(tools.length).toBeGreaterThan(0);
    const tuples = tools.filter((t) => /"items":\[/.test(JSON.stringify(t.inputSchema))).map((t) => t.name);
    expect(tuples).toEqual([]);
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

    // Un cliente registrado a mano (Gemini Enterprise) manda id y secreto por HTTP Basic.
    const third = new URL(
      (await app.inject({ method: "POST", url: "/v1/account/oauth/approve", headers: svc, payload: { ...params, agent_id: agent.id } })).json()
        .redirect_to,
    ).searchParams.get("code")!;
    const viaBasic = await app.inject({
      method: "POST",
      url: "/oauth/token",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${Buffer.from(`${client_id}:any-secret`).toString("base64")}`,
      },
      payload: new URLSearchParams({ grant_type: "authorization_code", code: third, redirect_uri: REDIRECT, code_verifier: verifier }).toString(),
    });
    expect(viaBasic.statusCode).toBe(200);
    expect(viaBasic.json().access_token).toMatch(/^rl_ag_/);

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
