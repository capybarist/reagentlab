import { createServer } from "node:net";
import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationFull, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { type Database, createAgentWithToken, createLab, ensureProblem, openDatabase, upsertUser } from "@reagentlab/db";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { MATHEMATICS_LAB, SEED_PROBLEMS } from "../src/seed.js";

/**
 * Conexión completa de clientes MCP reales, por HTTP: registro dinámico, consentimiento,
 * token, `initialize`, `tools/list` y una llamada a una tool. Cada perfil reproduce lo que
 * manda un cliente conocido (Gemini, ChatGPT, el SDK oficial que usan Claude y Cursor, un
 * cliente HTTP a pelo). Lo que rompió a Gemini en los PRs #37–#43 queda aquí.
 */

const PEPPER = "clients-pepper";
const KEY = "svc-key";
const WEB = "https://web.example.test";
const SLUG = MATHEMATICS_LAB.slug;
const PROTOCOL = "2025-06-18";

let database: Database;
let app: FastifyInstance;
let issuer: string;
let human: { id: string };
let agentSeq = 0;

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer().listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      srv.close(() => resolve(typeof addr === "object" && addr ? addr.port : 0));
    });
  });
}

beforeAll(async () => {
  database = await openDatabase("pglite:memory");
  await database.migrate();
  await createLab(database.db, MATHEMATICS_LAB);
  await ensureProblem(database.db, SLUG, SEED_PROBLEMS.mathematics![0]!);
  const port = await freePort();
  issuer = `http://127.0.0.1:${port}`;
  ({ app } = buildApp({ db: database.db, tokenPepper: PEPPER, webServiceKey: KEY, rateLimitPerMinute: 0, oauth: { issuer, webUrl: WEB } }));
  await app.listen({ port, host: "127.0.0.1" });
  human = await upsertUser(database.db, { provider: "github", providerId: "clients", handle: "clients" });
});

afterAll(async () => {
  await app.close();
  await database.close();
});

/** Lo que hace la web cuando el humano elige uno de sus agentes en /oauth/authorize. */
async function consent(authorizeUrl: string, family: string): Promise<URL> {
  const toWeb = await fetch(authorizeUrl, { redirect: "manual" });
  expect(toWeb.status).toBe(302);
  const web = new URL(toWeb.headers.get("location")!);
  expect(web.origin + web.pathname).toBe(`${WEB}/oauth/authorize`);
  const { agent } = await createAgentWithToken(
    database.db,
    { userId: human.id, name: `agent-${++agentSeq}`, modelFamily: family },
    PEPPER,
  );
  const res = await fetch(`${issuer}/v1/account/oauth/approve`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-reagent-service-key": KEY, "x-reagent-user": human.id },
    body: JSON.stringify({ ...Object.fromEntries(web.searchParams), agent_id: agent.id }),
  });
  expect(res.status).toBe(200);
  return new URL(((await res.json()) as { redirect_to: string }).redirect_to);
}

async function form(url: string, body: Record<string, string>, headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(body).toString(),
  });
  return { status: res.status, json: (await res.json()) as Record<string, string> };
}

/** JSON-RPC a pelo, como un cliente que no usa el SDK. Acepta respuesta JSON o SSE. */
async function rpc(path: string, token: string, accept: string | null, method: string, params: unknown, id: number | null = 1) {
  const headers: Record<string, string> = { "content-type": "application/json", authorization: `Bearer ${token}` };
  if (accept !== null) headers.accept = accept;
  const res = await fetch(`${issuer}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(id === null ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id, method, params }),
  });
  const text = await res.text();
  if (id === null) return { status: res.status, body: null };
  const json = res.headers.get("content-type")?.includes("text/event-stream")
    ? JSON.parse(text.split("\n").find((l) => l.startsWith("data: "))!.slice(6))
    : JSON.parse(text);
  return { status: res.status, body: json as { result?: any; error?: unknown } };
}

/** Sesión completa tras tener token: initialize, initialized, tools/list y join_lab. */
async function session(path: string, token: string, accept: string | null) {
  const init = await rpc(path, token, accept, "initialize", {
    protocolVersion: PROTOCOL,
    capabilities: {},
    clientInfo: { name: "profile", version: "0" },
  });
  expect(init.status).toBe(200);
  expect(init.body?.result?.serverInfo).toBeDefined();
  expect((await rpc(path, token, accept, "notifications/initialized", {}, null)).status).toBeLessThan(300);
  const list = await rpc(path, token, accept, "tools/list", {}, 2);
  expect(list.status).toBe(200);
  const tools = list.body!.result.tools as { name: string; inputSchema: unknown }[];
  expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["join_lab", "post", "end_turn"]));
  const join = await rpc(path, token, accept, "tools/call", { name: "join_lab", arguments: { slug: SLUG } }, 3);
  expect(join.status).toBe(200);
  expect(join.body!.result.isError).toBeFalsy();
  expect(JSON.parse(join.body!.result.content[0].text)).toMatchObject({ lab: { slug: SLUG } });
  return tools;
}

/** Subconjunto de JSON Schema que entienden todos (Gemini es el más estricto). */
function unportable(tools: { name: string; inputSchema: unknown }[]) {
  const bad: string[] = [];
  const walk = (name: string, node: unknown): void => {
    if (Array.isArray(node)) return node.forEach((n) => walk(name, n));
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    if (Array.isArray(o.items)) bad.push(`${name}: tuple items`);
    if ("$ref" in o) bad.push(`${name}: $ref`);
    for (const v of Object.values(o)) walk(name, v);
  };
  for (const t of tools) {
    expect(t.inputSchema).toMatchObject({ type: "object" });
    walk(t.name, t.inputSchema);
  }
  return bad;
}

describe("clientes MCP de punta a punta", () => {
  it("SDK oficial (Claude, Cursor y demás clientes del SDK): descubre, se registra y conecta solo", async () => {
    const redirectUrl = "http://127.0.0.1:33418/callback";
    let info: OAuthClientInformationFull | undefined;
    let tokens: OAuthTokens | undefined;
    let verifier = "";
    let redirectedTo: URL | undefined;
    const provider: OAuthClientProvider = {
      get redirectUrl() {
        return redirectUrl;
      },
      get clientMetadata(): OAuthClientMetadata {
        return { client_name: "SDK client", redirect_uris: [redirectUrl], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" };
      },
      state: () => "sdk-state",
      clientInformation: () => info,
      saveClientInformation: (i) => {
        info = i;
      },
      tokens: () => tokens,
      saveTokens: (t) => {
        tokens = t;
      },
      redirectToAuthorization: (url) => {
        redirectedTo = url;
      },
      saveCodeVerifier: (v) => {
        verifier = v;
      },
      codeVerifier: () => verifier,
    };
    const url = new URL(`${issuer}/mcp`);
    const first = new StreamableHTTPClientTransport(url, { authProvider: provider });
    await expect(new Client({ name: "sdk", version: "0" }).connect(first)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(info?.client_id).toBeDefined();
    expect(redirectedTo?.searchParams.get("code_challenge_method")).toBe("S256");

    const back = await consent(redirectedTo!.toString(), "claude");
    expect(back.searchParams.get("state")).toBe("sdk-state");
    await first.finishAuth(back.searchParams.get("code")!);
    expect(tokens?.access_token).toMatch(/^rl_ag_/);

    const client = new Client({ name: "sdk", version: "0" });
    await client.connect(new StreamableHTTPClientTransport(url, { authProvider: provider }));
    const { tools } = await client.listTools();
    expect(unportable(tools)).toEqual([]);
    const join = await client.callTool({ name: "join_lab", arguments: { slug: SLUG } });
    expect(join.isError).toBeFalsy();
    await client.close();
  });

  it("Gemini: cliente confidencial, relés de Google, state largo, sin PKCE y Accept solo JSON en /mcp/", async () => {
    const reg = await fetch(`${issuer}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Google",
        redirect_uris: ["oauth-redirect", "oauth-redirect-test", "oauth-redirect-sandbox"].flatMap((host) =>
          ["r", "a"].map((p) => `https://${host}.googleusercontent.com/${p}/user_bound_custom-mcp-1-api.example`),
        ),
        response_types: ["code"],
        token_endpoint_auth_method: "client_secret_post",
        grant_types: ["authorization_code", "refresh_token"],
      }),
    });
    expect(reg.status).toBe(201);
    const { client_id, client_secret, redirect_uris } = (await reg.json()) as { client_id: string; client_secret: string; redirect_uris: string[] };
    const redirect_uri = redirect_uris[0]!;
    const state = "g".repeat(3000);
    const params = { client_id, redirect_uri, response_type: "code", state, code_challenge: "plain-challenge", code_challenge_method: "plain" };
    const back = await consent(`${issuer}/oauth/authorize?${new URLSearchParams(params)}`, "gemini");
    expect(back.searchParams.get("state")).toBe(state);
    const tok = await form(`${issuer}/oauth/token`, {
      grant_type: "authorization_code",
      code: back.searchParams.get("code")!,
      redirect_uri,
      client_id,
      client_secret,
    });
    expect(tok.status).toBe(200);
    const refreshed = await form(`${issuer}/oauth/token`, { grant_type: "refresh_token", refresh_token: tok.json.refresh_token!, client_id, client_secret });
    expect(refreshed.status).toBe(200);

    const tools = await session("/mcp/", refreshed.json.access_token!, "application/json");
    expect(unportable(tools)).toEqual([]);
  });

  it("ChatGPT: cliente público con PKCE S256 y SSE", async () => {
    const redirect_uri = "https://chatgpt.com/connector_platform_oauth_redirect";
    const reg = await fetch(`${issuer}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "ChatGPT",
        redirect_uris: [redirect_uri],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    });
    expect(reg.status).toBe(201);
    const { client_id } = (await reg.json()) as { client_id: string };
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const params = { client_id, redirect_uri, response_type: "code", state: "c", code_challenge: challenge, code_challenge_method: "S256", resource: `${issuer}/mcp` };
    const back = await consent(`${issuer}/oauth/authorize?${new URLSearchParams(params)}`, "gpt");
    const tok = await form(`${issuer}/oauth/token`, {
      grant_type: "authorization_code",
      code: back.searchParams.get("code")!,
      redirect_uri,
      client_id,
      code_verifier: verifier,
      resource: `${issuer}/mcp`,
    });
    expect(tok.status).toBe(200);
    await session("/mcp", tok.json.access_token!, "application/json, text/event-stream");
  });

  it("cliente HTTP a pelo: token de la cuenta y sin cabecera Accept", async () => {
    const { token } = await createAgentWithToken(database.db, { userId: human.id, name: "curl-agent", modelFamily: "llama" }, PEPPER);
    await session("/mcp", token, null);
  });
});
