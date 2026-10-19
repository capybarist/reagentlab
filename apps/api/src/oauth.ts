import { createHash, randomBytes } from "node:crypto";
import { OAuthAuthorizeParams, OAuthRegisterInput } from "@reagentlab/contracts";
import { type Clock, systemClock } from "@reagentlab/core";
import { type Db, consumeOAuthCode, getOAuthClient, issueToken, registerOAuthClient } from "@reagentlab/db";
import type { FastifyInstance, FastifyReply } from "fastify";

/**
 * OAuth 2.1 para MCP (ADR-0035). Esta API es a la vez servidor de recursos (`/mcp`) y servidor de
 * autorización: metadatos (RFC 9728 y RFC 8414), registro dinámico de clientes (RFC 7591),
 * `/oauth/authorize`, que manda al humano a la web para elegir agente, y `/oauth/token`, que
 * cambia el código (con PKCE S256) por un token de agente normal.
 */
export interface OAuthOptions {
  db: Db;
  tokenPepper: string;
  /** URL pública de esta API: emisor y base de los endpoints. */
  issuer: string;
  /** URL de la web, donde el humano inicia sesión y elige agente. */
  webUrl: string;
  clock?: Clock;
}

const oauthError = (reply: FastifyReply, status: number, error: string, description: string) =>
  reply.status(status).header("cache-control", "no-store").send({ error, error_description: description });

export const resourceMetadataUrl = (issuer: string) => `${issuer.replace(/\/$/, "")}/.well-known/oauth-protected-resource`;

export function registerOAuthRoutes(app: FastifyInstance, opts: OAuthOptions) {
  const clock = opts.clock ?? systemClock;
  const issuer = opts.issuer.replace(/\/$/, "");

  // Los clientes mandan el token y el registro como formulario o JSON.
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) =>
    done(null, Object.fromEntries(new URLSearchParams(body as string))),
  );

  const protectedResource = async () => ({
    resource: `${issuer}/mcp`,
    authorization_servers: [issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: ["participate"],
    resource_name: "Reagent Lab",
  });
  app.get("/.well-known/oauth-protected-resource", protectedResource);
  app.get("/.well-known/oauth-protected-resource/mcp", protectedResource);

  app.get("/.well-known/oauth-authorization-server", async () => ({
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_basic", "client_secret_post"],
    scopes_supported: ["participate"],
    authorization_response_iss_parameter_supported: true,
  }));

  app.post("/oauth/register", async (req, reply) => {
    const parsed = OAuthRegisterInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      return oauthError(reply, 400, "invalid_client_metadata", parsed.error.issues.map((i) => i.message).join("; "));
    }
    const c = await registerOAuthClient(opts.db, {
      name: parsed.data.client_name ?? "MCP client",
      redirectUris: parsed.data.redirect_uris,
      now: clock.now(),
    });
    // Si el cliente pidió autenticarse con secreto, se le da uno para que no se rinda (Gemini pasa
    // entonces a pedir id y secreto a mano). No se guarda ni se comprueba: el token lo protege PKCE.
    const method = parsed.data.token_endpoint_auth_method;
    const withSecret = method === "client_secret_basic" || method === "client_secret_post";
    return reply.status(201).header("cache-control", "no-store").send({
      client_id: c.clientId,
      ...(withSecret ? { client_secret: randomBytes(24).toString("base64url"), client_secret_expires_at: 0 } : {}),
      client_name: c.name,
      redirect_uris: c.redirectUris,
      token_endpoint_auth_method: withSecret ? method : "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
      client_id_issued_at: Math.floor(c.createdAt.getTime() / 1000),
    });
  });

  /** Comprueba cliente y redirect_uri, y manda al humano a la web con los mismos parámetros. */
  app.get<{ Querystring: Record<string, string> }>("/oauth/authorize", async (req, reply) => {
    const client = req.query.client_id ? await getOAuthClient(opts.db, req.query.client_id) : null;
    // Sin cliente o con un redirect_uri que no es suyo no se redirige a ningún sitio (RFC 6749 §4.1.2.1).
    if (!client || !client.redirectUris.includes(req.query.redirect_uri ?? "")) {
      return oauthError(reply, 400, "invalid_request", "Unknown client_id or redirect_uri not registered for it.");
    }
    const parsed = OAuthAuthorizeParams.safeParse(req.query);
    if (!parsed.success) {
      const back = new URL(req.query.redirect_uri!);
      back.searchParams.set("error", "invalid_request");
      back.searchParams.set("error_description", parsed.error.issues.map((i) => i.message).join("; "));
      if (req.query.state) back.searchParams.set("state", req.query.state);
      return reply.redirect(back.toString(), 302);
    }
    const web = new URL(`${opts.webUrl.replace(/\/$/, "")}/oauth/authorize`);
    for (const [k, v] of Object.entries(parsed.data)) if (v !== undefined) web.searchParams.set(k, v);
    return reply.redirect(web.toString(), 302);
  });

  app.post("/oauth/token", async (req, reply) => {
    const b = { ...((req.body ?? {}) as Record<string, string | undefined>) };
    // Clientes que se registran a mano con id y secreto (Gemini Enterprise) pueden mandarlos por HTTP
    // Basic (client_secret_basic). Los clientes son públicos: el secreto no se comprueba, manda PKCE.
    const basic = /^Basic\s+(.+)$/i.exec(req.headers.authorization ?? "");
    if (basic && !b.client_id) {
      const [id] = Buffer.from(basic[1]!, "base64").toString("utf8").split(":");
      if (id) b.client_id = decodeURIComponent(id);
    }
    if (b.grant_type !== "authorization_code") {
      return oauthError(reply, 400, "unsupported_grant_type", "Only authorization_code is supported.");
    }
    if (!b.code || !b.code_verifier || !b.redirect_uri || !b.client_id) {
      return oauthError(reply, 400, "invalid_request", "code, code_verifier, redirect_uri and client_id are required.");
    }
    const row = await consumeOAuthCode(opts.db, b.code, clock.now());
    const challenge = createHash("sha256").update(b.code_verifier).digest("base64url");
    if (!row || row.clientId !== b.client_id || row.redirectUri !== b.redirect_uri || row.codeChallenge !== challenge) {
      return oauthError(reply, 400, "invalid_grant", "The code is invalid, expired, already used, or does not match.");
    }
    const { token } = await issueToken(opts.db, row.agentId, opts.tokenPepper);
    return reply.header("cache-control", "no-store").header("pragma", "no-cache").send({
      access_token: token,
      token_type: "Bearer",
      scope: "participate",
    });
  });
}
