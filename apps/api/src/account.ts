import { timingSafeEqual } from "node:crypto";
import {
  type AgentView,
  CreateAgentInput,
  type IssuedToken,
  type TokenView,
  UpsertUserInput,
  type UserView,
} from "@reagentlab/contracts";
import { DomainError, type LabService, agentCreationBlocker, type Clock, systemClock } from "@reagentlab/core";
import type { ProblemReview, ProblemView } from "@reagentlab/contracts";
import {
  type Db,
  countActiveAgents,
  createAgentWithToken,
  disableAgent,
  getAgentOfUser,
  getUser,
  hashToken,
  issueToken,
  listAgentsWithTokens,
  revokeToken,
  upsertUser,
} from "@reagentlab/db";
import type { FastifyInstance, FastifyRequest } from "fastify";

/**
 * Rutas de cuenta para la web (`/v1/account`). Solo las llama el servidor de
 * Next.js: se autentica con la clave de servicio compartida y dice qué humano
 * actúa en `x-reagent-user`. El navegador nunca ve esa clave.
 */
export interface AccountOptions {
  db: Db;
  tokenPepper: string;
  serviceKey: string;
  clock?: Clock;
  /** Agentes de desarrollo con token fijo (`DEV_AGENTS`). Vacío en producción. */
  devAgents?: { handle: string; name: string; token: string }[];
  /** Casos de uso de las salas: proponer y revisar problemas (ADR-0020). */
  service: LabService;
  /** Handles (GitHub, o del login de desarrollo en local) que pueden aprobar problemas. */
  adminHandles?: string[];
}

const MAX_TOKENS_PER_AGENT = 3;

export function sameSecret(a: string, b: string): boolean {
  if (!b) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function tokenView(t: { id: string; prefix: string; createdAt: Date; lastUsedAt: Date | null }): TokenView {
  return { id: t.id, prefix: t.prefix, created_at: t.createdAt.toISOString(), last_used_at: iso(t.lastUsedAt) };
}

export function registerAccountRoutes(app: FastifyInstance, opts: AccountOptions) {
  const clock = opts.clock ?? systemClock;

  const requireService = (req: FastifyRequest) => {
    const key = req.headers["x-reagent-service-key"];
    if (!opts.serviceKey || typeof key !== "string" || !sameSecret(key, opts.serviceKey)) {
      throw new DomainError("UNAUTHORIZED", "Service key missing or invalid.");
    }
  };

  const requireUser = async (req: FastifyRequest) => {
    requireService(req);
    const id = req.headers["x-reagent-user"];
    const user = typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id) ? await getUser(opts.db, id) : null;
    if (!user) throw new DomainError("UNAUTHORIZED", "Unknown user.");
    return user;
  };

  const admins = new Set((opts.adminHandles ?? []).map((h) => h.toLowerCase()));
  const isAdmin = (user: { handle: string; bannedAt: Date | null }) => !user.bannedAt && admins.has(user.handle.toLowerCase());
  const requireAdmin = async (req: FastifyRequest) => {
    const user = await requireUser(req);
    if (!isAdmin(user)) throw new DomainError("FORBIDDEN", "Solo los administradores revisan problemas.");
    return user;
  };

  const userView = async (user: NonNullable<Awaited<ReturnType<typeof getUser>>>): Promise<UserView> => {
    const blocker = agentCreationBlocker(
      {
        bannedAt: user.bannedAt,
        accountCreatedAt: user.accountCreatedAt,
        provider: user.provider,
        activeAgents: await countActiveAgents(opts.db, user.id),
      },
      clock.now(),
    );
    return {
      id: user.id,
      provider: user.provider,
      handle: user.handle,
      banned: !!user.bannedAt,
      reputation: user.reputation,
      is_admin: isAdmin(user),
      can_create_agents: !blocker,
      ...(blocker ? { reason: blocker.message } : {}),
    };
  };

  const agentOf = async (userId: string, agentId: string) => {
    const agent = /^[0-9a-f-]{36}$/i.test(agentId) ? await getAgentOfUser(opts.db, userId, agentId) : null;
    if (!agent) throw new DomainError("AGENT_NOT_FOUND", "No such agent in your account.");
    return agent;
  };

  /** La web lo llama al iniciar sesión: crea o actualiza al humano y devuelve su id. */
  app.post("/v1/account/users", async (req) => {
    requireService(req);
    const parsed = UpsertUserInput.safeParse(req.body);
    if (!parsed.success) throw new DomainError("VALIDATION_FAILED", "Invalid user payload.", undefined, parsed.error.issues);
    const u = parsed.data;
    const user = await upsertUser(opts.db, {
      provider: u.provider,
      providerId: u.provider_id,
      handle: u.handle,
      accountCreatedAt: u.account_created_at ? new Date(u.account_created_at) : undefined,
    });
    return userView(user);
  });

  app.get("/v1/account/me", async (req) => userView(await requireUser(req)));

  app.get("/v1/account/agents", async (req): Promise<{ agents: AgentView[] }> => {
    const user = await requireUser(req);
    const rows = await listAgentsWithTokens(opts.db, user.id);
    return {
      agents: rows.map((a) => ({
        id: a.id,
        name: a.name,
        model_family: a.modelFamily,
        status: a.status,
        created_at: a.createdAt.toISOString(),
        tokens: a.tokens.map(tokenView),
        ...devToken(user, a),
      })),
    };
  });

  /** El token fijo de un agente de DEV_AGENTS, solo si sigue siendo uno de sus tokens vigentes. */
  function devToken(
    user: { provider: string; handle: string },
    a: { name: string; status: string; tokens: { tokenHash: string }[] },
  ): { dev_token?: string } {
    if (user.provider !== "dev" || a.status !== "active") return {};
    const dev = opts.devAgents?.find((d) => d.handle === user.handle && d.name === a.name);
    if (!dev || !a.tokens.some((t) => t.tokenHash === hashToken(dev.token, opts.tokenPepper))) return {};
    return { dev_token: dev.token };
  }

  app.post("/v1/account/agents", async (req, reply) => {
    const user = await requireUser(req);
    const parsed = CreateAgentInput.safeParse(req.body);
    if (!parsed.success) {
      throw new DomainError("VALIDATION_FAILED", "Invalid agent.", "Check the name and model family.", parsed.error.issues);
    }
    const blocker = agentCreationBlocker(
      {
        bannedAt: user.bannedAt,
        accountCreatedAt: user.accountCreatedAt,
        provider: user.provider,
        activeAgents: await countActiveAgents(opts.db, user.id),
      },
      clock.now(),
    );
    if (blocker) throw blocker;
    try {
      const { agent, token } = await createAgentWithToken(
        opts.db,
        { userId: user.id, name: parsed.data.name, modelFamily: parsed.data.model_family },
        opts.tokenPepper,
      );
      const [row] = (await listAgentsWithTokens(opts.db, user.id)).filter((a) => a.id === agent.id);
      const issued: IssuedToken & { agent_id: string } = {
        agent_id: agent.id,
        token,
        token_info: tokenView(row!.tokens[0]!),
      };
      return reply.status(201).send(issued);
    } catch (e) {
      if (String((e as { cause?: unknown }).cause ?? e).includes("agents_user_name_uq")) {
        throw new DomainError("VALIDATION_FAILED", "You already have an agent with that name.");
      }
      throw e;
    }
  });

  app.post<{ Params: { id: string } }>("/v1/account/agents/:id/tokens", async (req, reply) => {
    const user = await requireUser(req);
    const agent = await agentOf(user.id, req.params.id);
    if (agent.status !== "active") throw new DomainError("FORBIDDEN", "This agent is not active.");
    const current = (await listAgentsWithTokens(opts.db, user.id)).find((a) => a.id === agent.id)!;
    if (current.tokens.length >= MAX_TOKENS_PER_AGENT) {
      throw new DomainError(
        "FORBIDDEN",
        `An agent can have at most ${MAX_TOKENS_PER_AGENT} active tokens.`,
        "Revoke an old token first.",
      );
    }
    const { token, row } = await issueToken(opts.db, agent.id, opts.tokenPepper);
    const issued: IssuedToken = { token, token_info: tokenView(row) };
    return reply.status(201).send(issued);
  });

  app.delete<{ Params: { id: string; tokenId: string } }>("/v1/account/agents/:id/tokens/:tokenId", async (req) => {
    const user = await requireUser(req);
    const agent = await agentOf(user.id, req.params.id);
    const ok = await revokeToken(opts.db, agent.id, req.params.tokenId);
    if (!ok) throw new DomainError("AGENT_NOT_FOUND", "No such active token.");
    return { revoked: true };
  });

  app.post<{ Params: { id: string } }>("/v1/account/agents/:id/disable", async (req) => {
    const user = await requireUser(req);
    const agent = await agentOf(user.id, req.params.id);
    await disableAgent(opts.db, agent.id);
    return { disabled: true };
  });

  // ── Problemas (ADR-0020) ────────────────────────────────────────────────

  /** Un humano propone un problema en una sala; queda pendiente de revisión. */
  app.post<{ Params: { slug: string } }>("/v1/account/labs/:slug/problems", async (req, reply) => {
    const user = await requireUser(req);
    if (user.bannedAt) throw new DomainError("USER_BANNED", "Tu cuenta está suspendida.");
    return reply.status(201).send(await opts.service.proposeProblem({ userId: user.id }, req.params.slug, req.body));
  });

  /** Administradores: problemas de todas las salas en un estado de revisión (por defecto, propuestos). */
  app.get<{ Querystring: { review?: string } }>("/v1/account/problems", async (req): Promise<{ problems: ProblemView[] }> => {
    await requireAdmin(req);
    const review = (req.query.review ?? "proposed") as ProblemReview;
    const labs = await opts.service.listLabs();
    const lists = await Promise.all(labs.map((l) => opts.service.listProblems(l.slug, [review])));
    return { problems: lists.flat() };
  });

  /** Administradores: aprobar, rechazar o archivar un problema. */
  app.post<{ Params: { slug: string; problem: string } }>(
    "/v1/account/labs/:slug/problems/:problem/review",
    async (req) => {
      await requireAdmin(req);
      return opts.service.reviewProblem(req.params.slug, req.params.problem, req.body);
    },
  );
}
