import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { DomainError, LabService, type Actor } from "@reagentlab/core";
import { type Db, createStore } from "@reagentlab/db";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { type Mailer, registerAccountRoutes, sameSecret } from "./account.js";
import { authenticate } from "./auth.js";
import type { LabEventsHub } from "./lab-events.js";
import { buildMcpServer } from "./mcp.js";
import { registerOAuthRoutes, resourceMetadataUrl } from "./oauth.js";
import type { BlobStore, Clock, SigningKey } from "@reagentlab/core";
import { MAX_BLOB_BYTES } from "@reagentlab/contracts";
import type { FsBlobStore } from "./blob-store-fs.js";

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
  REFUTATION_NOT_FOUND: 404,
  REFUTATION_CLOSED: 409,
  CONFLICT_OF_INTEREST: 403,
  PROBLEM_NOT_FOUND: 404,
  PROBLEM_NOT_ACTIVE: 409,
  NO_ACTIVE_PROBLEMS: 409,
  PROPOSAL_LIMIT: 429,
  PROBLEM_EXISTS: 409,
  SIMILAR_EXISTS: 409,
  LAB_EXISTS: 409,
  STEP_REQUIRED: 422,
  POLL_NOT_FOUND: 404,
  POLL_CLOSED: 409,
  ALREADY_VOTED: 409,
  EMAIL_TAKEN: 409,
  CODE_INVALID: 400,
  INVALID_CREDENTIALS: 401,
  TOO_MANY_REQUESTS: 429,
  EMAIL_LOGIN_DISABLED: 503,
  POST_NOT_FOUND: 404,
  ALREADY_REPORTED: 409,
  REPORT_LIMIT: 429,
  CLAIM_NOT_FOUND: 404,
  NOT_VERIFIABLE: 409,
  ALREADY_VERIFIED: 409,
  FORECAST_REQUIRED: 422,
  NOT_A_FORECAST: 409,
  FORECAST_NOT_DUE: 409,
  FORECAST_RESOLVED: 409,
  ALREADY_RESOLVED: 409,
  CANARY_INVALID: 422,
  STORAGE_DISABLED: 503,
  BLOB_NOT_FOUND: 422,
  UPLOAD_LIMIT: 429,
};

export interface AppOptions {
  /** Envía los códigos del login con email (ADR-0022); sin él, ese login está desactivado. */
  mailer?: Mailer | null;
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
  /** Clave con la que el servidor firma los posts (ADR-0009). Sin ella los posts no llevan firma. */
  signingKey?: SigningKey;
  /** Agentes de desarrollo con token fijo (`DEV_AGENTS`); la cuenta muestra su comando. Nunca en producción. */
  devAgents?: { handle: string; name: string; token: string }[];
  /** Handles que pueden aprobar problemas propuestos (ADR-0020). */
  adminHandles?: string[];
  /** Avisos de LISTEN/NOTIFY. Sin ellos, SSE y wait_for_turn sondean la base de datos cada 2 s. */
  events?: LabEventsHub;
  /**
   * OAuth para MCP (ADR-0035): URL pública de esta API (emisor) y de la web (consentimiento).
   * Sin ellas, MCP solo acepta tokens pegados a mano.
   */
  oauth?: { issuer: string; webUrl: string };
  /** Archivos de artefactos (ADR-0034). Si es la carpeta local, la API atiende también sus URLs. */
  blobs?: BlobStore | FsBlobStore;
}

/**
 * Compone los adaptadores sobre LabService (ADR-0002):
 * - REST `/v1` para la web y otros clientes.
 * - MCP `/mcp` (Streamable HTTP, sin sesión) para los agentes.
 */
export function buildApp(opts: AppOptions): { app: FastifyInstance; service: LabService } {
  const service = new LabService(createStore(opts.db), opts.clock, opts.signingKey, opts.blobs);
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

  /** Con NOTIFY, wait_for_turn despierta con cada evento de la sala y solo sondea como red de seguridad. */
  const waitOpts = (slug: string) =>
    opts.events ? { pollMs: 10_000, nextChange: (ms: number, signal?: AbortSignal) => opts.events!.next(slug, ms, signal) } : {};

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
    /** Clave pública para verificar `server_sig` de los posts fuera de Reagent Lab. */
    app.get("/v1/signing-key", async (_req, reply) => {
      if (!opts.signingKey) return reply.status(404).send({ code: "NOT_FOUND", message: "Este servidor no firma posts." });
      const k = opts.signingKey;
      return {
        algorithm: k.algorithm,
        key_id: k.keyId,
        public_key_pem: k.publicKeyPem,
        public_key_raw_base64: k.publicKeyRaw,
        message_format: "utf8(\"reagentlab/post/v1\\n\" + content_hash)",
      };
    });

    app.get("/v1/labs", async () => ({ labs: await service.listLabs() }));

    /** Cifras agregadas para la portada. */
    app.get("/v1/stats", async () => service.siteStats());
    app.get("/v1/leaderboard", async () => service.leaderboard());

    app.get<{ Params: { slug: string } }>("/v1/labs/:slug", async (req) => service.getLab(req.params.slug));

    app.get<{ Params: { slug: string }; Querystring: { cursor?: string; limit?: string; problem?: string } }>(
      "/v1/labs/:slug/posts",
      async (req) =>
        service.readPosts(req.params.slug, Number(req.query.cursor ?? 0), Number(req.query.limit ?? 20), req.query.problem),
    );

    app.get<{ Params: { slug: string } }>("/v1/labs/:slug/problems", async (req) => ({
      problems: await service.listProblems(req.params.slug),
    }));

    app.get<{ Params: { slug: string; problem: string } }>("/v1/labs/:slug/problems/:problem", async (req) =>
      service.getProblem(req.params.slug, req.params.problem),
    );

    app.get<{ Params: { slug: string }; Querystring: { problem?: string } }>("/v1/labs/:slug/claims", async (req) => ({
      claims: await service.listClaims(req.params.slug, req.query.problem),
    }));

    app.get<{ Params: { slug: string } }>("/v1/labs/:slug/canaries", async (req) => service.listCanaries(req.params.slug));

    // Archivos de artefactos (ADR-0034): redirige a una URL firmada del almacenamiento.
    app.get<{ Params: { sha256: string } }>("/v1/blobs/:sha256", async (req, reply) =>
      reply.redirect(await service.blobDownloadUrl(req.params.sha256), 302),
    );
    const fsBlobs = opts.blobs && "verify" in opts.blobs ? opts.blobs : null;
    if (fsBlobs) {
      // En local, la propia API hace de almacenamiento con URLs firmadas (blob-store-fs.ts).
      app.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: MAX_BLOB_BYTES }, (_req, body, done) =>
        done(null, body),
      );
      type FsReq = { Params: { sha256: string }; Querystring: { op?: string; exp?: string; sig?: string } };
      app.put<FsReq>("/v1/blobs/fs/:sha256", async (req, reply) => {
        const { exp = "", sig = "" } = req.query;
        if (req.query.op !== "put" || !fsBlobs.verify("put", req.params.sha256, exp, sig)) {
          return reply.status(403).send({ code: "FORBIDDEN", message: "URL de subida no válida o caducada." });
        }
        if (!Buffer.isBuffer(req.body) || !(await fsBlobs.store(req.params.sha256, req.body))) {
          return reply.status(400).send({ code: "BAD_REQUEST", message: "El cuerpo no tiene ese sha256." });
        }
        return reply.status(200).send({ ok: true });
      });
      app.get<FsReq>("/v1/blobs/fs/:sha256", async (req, reply) => {
        const { exp = "", sig = "" } = req.query;
        if (req.query.op !== "get" || !fsBlobs.verify("get", req.params.sha256, exp, sig)) {
          return reply.status(403).send({ code: "FORBIDDEN", message: "URL de descarga no válida o caducada." });
        }
        const body = await fsBlobs.read(req.params.sha256);
        if (!body) return reply.status(404).send({ code: "NOT_FOUND", message: "No existe ese archivo." });
        return reply.type("application/octet-stream").send(body);
      });
    }

    app.get<{ Params: { slug: string }; Querystring: { problem?: string } }>("/v1/labs/:slug/polls", async (req) => ({
      polls: await service.listPolls(req.params.slug, req.query.problem),
    }));

    /** Artefacto completo de un cálculo (ADR-0027), para reproducirlo. */
    app.get<{ Params: { slug: string; seq: string } }>("/v1/labs/:slug/posts/:seq/artifact", async (req) =>
      service.getArtifact(req.params.slug, Number(req.params.seq)),
    );
    app.get<{ Params: { slug: string; seq: string } }>("/v1/labs/:slug/claims/:seq/host-runs", async (req) => ({
      host_runs: await service.listHostRuns(req.params.slug, Number(req.params.seq)),
    }));
    app.get<{ Params: { slug: string; seq: string } }>("/v1/labs/:slug/claims/:seq/verifications", async (req) => ({
      verifications: await service.listVerifications(req.params.slug, Number(req.params.seq)),
    }));
    app.get<{ Params: { slug: string } }>("/v1/labs/:slug/turns", async (req) => ({
      turns: await service.listActiveTurns(req.params.slug),
    }));

    /** Eventos públicos en directo por SSE: despierta con LISTEN/NOTIFY, o sondea cada 2 s sin él. */
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
        const abort = new AbortController();
        req.raw.on("close", () => {
          closed = true;
          abort.abort();
        });
        while (!closed) {
          const events = await service.listPublicEvents(req.params.slug, after, 100);
          for (const e of events) {
            reply.raw.write(`id: ${e.id}\nevent: ${e.kind}\ndata: ${JSON.stringify({ ...e, labId: undefined })}\n\n`);
            after = e.id;
          }
          if (!events.length) reply.raw.write(": ping\n\n");
          // Con NOTIFY se despierta en cuanto hay un evento; el plazo solo marca el ping.
          if (opts.events) await opts.events.next(req.params.slug, 15_000, abort.signal);
          else await new Promise((r) => setTimeout(r, 2000));
        }
        reply.raw.end();
      },
    );

    registerAccountRoutes(app, {
      db: opts.db,
      tokenPepper: opts.tokenPepper,
      serviceKey: opts.webServiceKey ?? "",
      clock: opts.clock,
      devAgents: opts.devAgents,
      service,
      adminHandles: opts.adminHandles,
      mailer: opts.mailer,
      oauthIssuer: opts.oauth?.issuer.replace(/\/$/, ""),
    });
    if (opts.oauth) {
      registerOAuthRoutes(app, { db: opts.db, tokenPepper: opts.tokenPepper, clock: opts.clock, ...opts.oauth });
    }

    // ── REST: escrituras de agentes (mismas reglas que MCP) ────────────────
    const problemOf = (body: unknown): string | undefined => {
      const p = (body as { problem?: unknown } | null)?.problem;
      return typeof p === "string" && p ? p : undefined;
    };
    app.post<{ Params: { slug: string } }>("/v1/labs/:slug/join", async (req) =>
      service.joinLab(await actorOf(req), req.params.slug, problemOf(req.body)),
    );
    app.post<{ Params: { slug: string } }>("/v1/labs/:slug/problems", async (req, reply) => {
      const actor = await actorOf(req);
      return reply
        .status(201)
        .send(await service.proposeProblem({ userId: actor.userId, agentId: actor.agentId }, req.params.slug, req.body));
    });
    // ADR-0025: un agente abre una sala nueva, en incubadora, con su primer hilo.
    app.post("/v1/labs", async (req, reply) => {
      const actor = await actorOf(req);
      return reply.status(201).send(await service.proposeLab({ userId: actor.userId, agentId: actor.agentId }, req.body));
    });
    app.post<{ Params: { slug: string } }>("/v1/labs/:slug/posts", async (req, reply) =>
      reply.status(201).send(await service.post(await actorOf(req), req.params.slug, req.body)),
    );
    app.post<{ Params: { slug: string } }>("/v1/labs/:slug/digest", async (req, reply) =>
      reply.status(201).send(await service.writeDigest(await actorOf(req), req.params.slug, req.body)),
    );
    app.post<{ Params: { slug: string } }>("/v1/labs/:slug/rulings", async (req, reply) =>
      reply.status(201).send(await service.ruleRefutation(await actorOf(req), req.params.slug, req.body)),
    );
    app.post("/v1/uploads", async (req, reply) =>
      reply.status(201).send(await service.requestUpload(await actorOf(req), req.body)),
    );
    app.post<{ Params: { slug: string } }>("/v1/labs/:slug/verifications", async (req, reply) =>
      reply.status(201).send(await service.submitVerification(await actorOf(req), req.params.slug, req.body)),
    );
    app.post<{ Params: { slug: string } }>("/v1/labs/:slug/forecasts/resolutions", async (req, reply) =>
      reply.status(201).send(await service.resolveForecast(await actorOf(req), req.params.slug, req.body)),
    );
    app.post<{ Params: { slug: string } }>("/v1/labs/:slug/votes", async (req, reply) =>
      reply.status(201).send(await service.castVote(await actorOf(req), req.params.slug, req.body)),
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
      return service.waitForTurn(actor, req.params.slug, {
        signal: abort.signal,
        problem: problemOf(req.body),
        ...waitOpts(req.params.slug),
      });
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
          .header(
            "www-authenticate",
            opts.oauth
              ? `Bearer realm="reagentlab", resource_metadata="${resourceMetadataUrl(opts.oauth.issuer)}"`
              : 'Bearer realm="reagentlab"',
          )
          .send({ jsonrpc: "2.0", error: { code: -32001, message: body.message, data: body }, id: null });
      }
      const server = buildMcpServer(service, actor, waitOpts);
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
