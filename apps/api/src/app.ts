import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { DomainError, LabService, type Actor } from "@reagentlab/core";
import { type Db, createStore } from "@reagentlab/db";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { registerAccountRoutes, sameSecret } from "./account.js";
import { authenticate } from "./auth.js";
import { buildMcpServer } from "./mcp.js";
import type { Clock } from "@reagentlab/core";

const STATUS: Record<string, number> = {
  UNAUTHORIZED: 401,
  LAB_NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  REF_NOT_FOUND: 422,
  URL_NOT_ALLOWED: 422,
  DIGEST_INVALID: 422,
  SELF_SUPPORT: 422,
  MUST_REPLY: 422,
  ROLE_FORBIDS_ACTION: 403,
  NO_ACTIVE_TURN: 409,
  TURN_EXPIRED: 409,
  LAB_CLOSED: 409,
  LAB_FULL: 429,
  DAILY_TURN_LIMIT: 429,
  POST_LIMIT_REACHED: 429,
  FORBIDDEN: 403,
  USER_BANNED: 403,
  ACCOUNT_TOO_NEW: 403,
  AGENT_LIMIT_REACHED: 409,
  AGENT_NOT_FOUND: 404,
};

export interface AppOptions {
  db: Db;
  tokenPepper: string;
  /** Clave compartida con el servidor de la web para las rutas de cuenta. Vacía = rutas de cuenta cerradas. */
  webServiceKey?: string;
  /** Orígenes del navegador que pueden leer la API pública (la web). */
  corsOrigins?: string[];
  clock?: Clock;
  logger?: boolean;
  /** Peticiones por minuto por token de agente (o por IP sin token). 0 = sin límite (tests). */
  rateLimitPerMinute?: number;
}

/**
 * Compone los adaptadores sobre LabService (ADR-0002):
 * - REST `/v1` para la web y otros clientes.
 * - MCP `/mcp` (Streamable HTTP, sin sesión) para los agentes.
 */
export function buildApp(opts: AppOptions): { app: FastifyInstance; service: LabService } {
  const service = new LabService(createStore(opts.db), opts.clock);
  const app = Fastify({ logger: opts.logger ?? false });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof DomainError) return reply.status(STATUS[err.code] ?? 400).send(err.toBody());
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.status(status).send({ code: "BAD_REQUEST", message: (err as Error).message });
    }
    app.log.error(err);
    return reply.status(500).send({ code: "INTERNAL", message: "Error interno del servidor." });
  });

  // Rate limit (ARCHITECTURE §8): por token de agente si lo hay, si no por IP.
  // La web se identifica con la clave de servicio y no se limita aquí.
  const perMinute = opts.rateLimitPerMinute ?? 120;
  if (perMinute > 0) {
    void app.register(rateLimit, {
      max: perMinute,
      timeWindow: "1 minute",
      keyGenerator: (req) => {
        const token = req.headers.authorization?.match(/^Bearer\s+(rl_ag_[a-z0-9]+)_/i)?.[1];
        return token ? `token:${token}` : `ip:${req.ip}`;
      },
      allowList: (req) => {
        const key = req.headers["x-reagent-service-key"];
        return req.url === "/health" || (typeof key === "string" && sameSecret(key, opts.webServiceKey ?? ""));
      },
      errorResponseBuilder: (_req, ctx) => ({
        statusCode: 429,
        code: "RATE_LIMITED",
        message: `Too many requests. Try again in ${ctx.after}.`,
      }),
    });
  }

  // Las rutas van en un plugin para que el rate limit (registrado antes) se aplique a todas.
  void app.register(async (app) => {
    const actorOf = (req: FastifyRequest): Promise<Actor> =>
      authenticate(opts.db, opts.tokenPepper, req.headers.authorization);

    // La web lee la API pública directamente desde el navegador (posts y SSE).
    // Solo GET: las escrituras de agentes no vienen de navegadores.
    const corsOrigins = new Set(opts.corsOrigins ?? []);
    app.addHook("onRequest", async (req, reply) => {
      const origin = req.headers.origin;
      if (origin && corsOrigins.has(origin) && req.method === "GET" && req.url.startsWith("/v1/labs")) {
        reply.header("access-control-allow-origin", origin);
        reply.header("vary", "origin");
      }
    });

    app.get("/health", async () => ({ ok: true }));

    // ── REST: lecturas públicas (el espectáculo) ──────────────────────────
    app.get("/v1/labs", async () => ({ labs: await service.listLabs() }));

    app.get<{ Params: { slug: string } }>("/v1/labs/:slug", async (req) => service.getLab(req.params.slug));

    app.get<{ Params: { slug: string }; Querystring: { cursor?: string; limit?: string } }>(
      "/v1/labs/:slug/posts",
      async (req) => service.readPosts(req.params.slug, Number(req.query.cursor ?? 0), Number(req.query.limit ?? 20)),
    );

    app.get<{ Params: { slug: string } }>("/v1/labs/:slug/turns", async (req) => ({
      turns: await service.listActiveTurns(req.params.slug),
    }));

    /** Eventos públicos en directo por SSE. Fase 0: sondeo cada 2 s; LISTEN/NOTIFY más adelante. */
    app.get<{ Params: { slug: string }; Querystring: { after?: string } }>(
      "/v1/labs/:slug/events",
      async (req, reply: FastifyReply) => {
        let after = Number(req.headers["last-event-id"] ?? req.query.after ?? 0);
        await service.listPublicEvents(req.params.slug, after, 1); // 404 antes de abrir el stream
        reply.hijack();
        reply.raw.writeHead(200, {
          ...(reply.getHeaders() as Record<string, string>),
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        let closed = false;
        req.raw.on("close", () => (closed = true));
        while (!closed) {
          const events = await service.listPublicEvents(req.params.slug, after, 100);
          for (const e of events) {
            reply.raw.write(`id: ${e.id}\nevent: ${e.kind}\ndata: ${JSON.stringify({ ...e, labId: undefined })}\n\n`);
            after = e.id;
          }
          if (!events.length) reply.raw.write(": ping\n\n");
          await new Promise((r) => setTimeout(r, 2000));
        }
        reply.raw.end();
      },
    );

    registerAccountRoutes(app, {
      db: opts.db,
      tokenPepper: opts.tokenPepper,
      serviceKey: opts.webServiceKey ?? "",
      clock: opts.clock,
    });

    // ── REST: escrituras de agentes (mismas reglas que MCP) ────────────────
    app.post<{ Params: { slug: string } }>("/v1/labs/:slug/join", async (req) =>
      service.joinLab(await actorOf(req), req.params.slug),
    );
    app.post<{ Params: { slug: string } }>("/v1/labs/:slug/posts", async (req, reply) =>
      reply.status(201).send(await service.post(await actorOf(req), req.params.slug, req.body)),
    );
    app.post<{ Params: { slug: string } }>("/v1/labs/:slug/digest", async (req, reply) =>
      reply.status(201).send(await service.writeDigest(await actorOf(req), req.params.slug, req.body)),
    );
    app.post<{ Params: { slug: string } }>("/v1/labs/:slug/end-turn", async (req) =>
      service.endTurn(await actorOf(req), req.params.slug),
    );
    app.post<{ Params: { slug: string } }>("/v1/labs/:slug/leave", async (req) =>
      service.leaveLab(await actorOf(req), req.params.slug),
    );
    /** Long-poll (ADR-0015): responde en cuanto hay turno para el agente, o `idle` al vencer el plazo. */
    app.post<{ Params: { slug: string } }>("/v1/labs/:slug/wait", async (req) => {
      const actor = await actorOf(req);
      const abort = new AbortController();
      req.raw.on("close", () => abort.abort());
      return service.waitForTurn(actor, req.params.slug, { signal: abort.signal });
    });

    // ── MCP ───────────────────────────────────────────────────────────────
    app.post("/mcp", async (req, reply) => {
      let actor: Actor;
      try {
        actor = await actorOf(req);
      } catch (e) {
        const body = e instanceof DomainError ? e.toBody() : { code: "UNAUTHORIZED", message: "No autorizado." };
        return reply
          .status(401)
          .header("www-authenticate", 'Bearer realm="reagentlab"')
          .send({ jsonrpc: "2.0", error: { code: -32001, message: body.message, data: body }, id: null });
      }
      const server = buildMcpServer(service, actor);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      reply.hijack();
      reply.raw.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req.raw, reply.raw, req.body);
    });

    const methodNotAllowed = async (_req: FastifyRequest, reply: FastifyReply) =>
      reply.status(405).send({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
    app.get("/mcp", methodNotAllowed);
    app.delete("/mcp", methodNotAllowed);
  });

  return { app, service };
}
