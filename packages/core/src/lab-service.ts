import {
  type ActiveTurnView,
  type ContextPack,
  type DigestView,
  type LabRules,
  type LabSummary,
  type PostView,
  type PostsPage,
  PostInput,
  ROLE_POST_TYPES,
  UNTRUSTED_NOTICE,
  WriteDigestInput,
  missingDigestSections,
  parseLabRules,
} from "@reagentlab/contracts";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { DomainError } from "./errors.js";
import { postContentHash } from "./hashing.js";
import type { Actor, Clock, EventRow, LabRow, Repos, Store, TurnRow } from "./ports.js";
import { systemClock } from "./ports.js";
import { ROLE_INSTRUCTIONS, assignRole } from "./roles.js";
import { isUrlAllowed, sanitizeUntrusted } from "./sanitize.js";
import { toDigestView, toPostView } from "./views.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function validationError(error: z.ZodError): DomainError {
  const issues = error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
  return new DomainError(
    "VALIDATION_FAILED",
    "La entrada no cumple el formato exigido.",
    "Corrige los campos indicados en `details` y vuelve a intentarlo.",
    issues,
  );
}

/**
 * Casos de uso de una sala. Es el ÚNICO sitio donde viven las reglas: REST y MCP
 * solo llaman aquí (ADR-0002).
 */
export class LabService {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock = systemClock,
  ) {}

  // ── Lecturas públicas ────────────────────────────────────────────────

  async listLabs(): Promise<LabSummary[]> {
    const now = this.clock.now();
    return this.store.read(async (r) => {
      const labs = await r.listLabs();
      return Promise.all(
        labs.map(async (l) => ({
          slug: l.slug,
          title: l.title,
          description: l.description,
          status: l.status,
          post_count: await r.countPosts(l.id),
          active_turns: await r.countActiveTurns(l.id, now),
        })),
      );
    });
  }

  async getLab(
    slug: string,
  ): Promise<{ lab: LabSummary; rules: LabRules; digest: DigestView | null; last_event_id: number }> {
    const now = this.clock.now();
    return this.store.read(async (r) => {
      const lab = await requireLab(r, slug);
      const digest = await r.latestDigest(lab.id);
      return {
        lab: {
          slug: lab.slug,
          title: lab.title,
          description: lab.description,
          status: lab.status,
          post_count: await r.countPosts(lab.id),
          active_turns: await r.countActiveTurns(lab.id, now),
        },
        rules: parseLabRules(lab.rules),
        digest: digest ? toDigestView(digest) : null,
        last_event_id: await r.latestPublicEventId(lab.id),
      };
    });
  }

  async getLabRules(slug: string): Promise<LabRules> {
    return (await this.getLab(slug)).rules;
  }

  async readPosts(slug: string, cursor = 0, limit = 20): Promise<PostsPage> {
    const lim = Math.min(Math.max(limit, 1), 100);
    return this.store.read(async (r) => {
      const lab = await requireLab(r, slug);
      const rows = await r.listPosts(lab.id, cursor, lim + 1);
      const page = rows.slice(0, lim);
      return {
        notice: UNTRUSTED_NOTICE,
        posts: page.map(toPostView),
        next_cursor: page.at(-1)?.seq ?? cursor,
        has_more: rows.length > lim,
      };
    });
  }

  /** Quién está trabajando ahora mismo en la sala y con qué rol. */
  async listActiveTurns(slug: string): Promise<ActiveTurnView[]> {
    const now = this.clock.now();
    return this.store.read(async (r) => {
      const lab = await requireLab(r, slug);
      const rows = await r.listActiveTurns(lab.id, now);
      return rows.map((t) => ({
        agent: { name: t.agentName, model_family: t.modelFamily },
        role: t.role,
        started_at: t.startedAt.toISOString(),
        lease_expires_at: t.leaseExpiresAt.toISOString(),
      }));
    });
  }

  async listPublicEvents(slug: string, afterId = 0, limit = 100): Promise<EventRow[]> {
    return this.store.read(async (r) => {
      const lab = await requireLab(r, slug);
      return r.listPublicEvents(lab.id, afterId, Math.min(limit, 500));
    });
  }

  // ── Turnos ───────────────────────────────────────────────────────────

  /**
   * Abre un turno (o devuelve el que ya está abierto, renovando el lease) y
   * entrega el paquete de contexto: digest + delta (ADR-0006).
   */
  async joinLab(actor: Actor, slug: string): Promise<ContextPack> {
    const now = this.clock.now();
    return this.store.transaction(async (r) => {
      const lab = await requireLab(r, slug, true);
      const rules = parseLabRules(lab.rules);
      if (lab.status === "green") {
        throw new DomainError("LAB_CLOSED", "La sala ya está verificada y no admite turnos.");
      }

      // Expira antes los turnos vencidos de la sala: liberan plaza y el puesto de escriba.
      for (const t of await r.expireTurns(now, lab.id)) {
        await r.insertEvent({
          labId: lab.id,
          kind: "turn.expired",
          actorAgentId: t.agentId,
          payload: { turn_id: t.id, role: t.role },
          public: true,
        });
      }

      let turn = await r.getActiveTurn(lab.id, actor.agentId);

      if (turn) {
        const leaseExpiresAt = lease(now, rules);
        await r.updateTurn(turn.id, { leaseExpiresAt });
        turn = { ...turn, leaseExpiresAt };
      } else {
        if ((await r.countActiveTurns(lab.id, now)) >= rules.max_active_turns) {
          throw new DomainError(
            "LAB_FULL",
            `La sala ya tiene ${rules.max_active_turns} turnos activos.`,
            "Vuelve a intentarlo más tarde.",
          );
        }
        const since = new Date(now.getTime() - DAY_MS);
        if ((await r.countTurnsSince(lab.id, actor.agentId, since)) >= rules.max_turns_per_agent_day) {
          throw new DomainError(
            "DAILY_TURN_LIMIT",
            `Este agente ya ha usado sus ${rules.max_turns_per_agent_day} turnos de las últimas 24 h en esta sala.`,
          );
        }
        const digest = await r.latestDigest(lab.id);
        const lastSeq = lab.nextSeq - 1;
        const role = assignRole(
          {
            postsSinceDigest: lastSeq - (digest?.basedOnSeq ?? 0),
            digestStaleAfter: rules.digest_stale_after_posts,
            hasActiveScribe: await r.hasActiveScribe(lab.id, now),
          },
          await r.lastTurnRole(lab.id, actor.agentId),
        );
        turn = await r.insertTurn({
          labId: lab.id,
          agentId: actor.agentId,
          role,
          status: "active",
          leaseExpiresAt: lease(now, rules),
          contextSeq: lastSeq,
          startedAt: now,
          endedAt: null,
        });
        await r.insertEvent(turnEvent("turn.started", lab, turn, actor));
      }

      return this.buildContext(r, lab, rules, turn);
    });
  }

  async leaveLab(actor: Actor, slug: string): Promise<{ turn_id: string; status: "closed" }> {
    const now = this.clock.now();
    return this.store.transaction(async (r) => {
      const lab = await requireLab(r, slug);
      const turn = await r.getActiveTurn(lab.id, actor.agentId);
      if (!turn) throw new DomainError("NO_ACTIVE_TURN", "No tienes un turno abierto en esta sala.");
      await r.updateTurn(turn.id, { status: "closed", endedAt: now });
      await r.insertEvent(turnEvent("turn.ended", lab, turn, actor));
      return { turn_id: turn.id, status: "closed" as const };
    });
  }

  /** Lo llama el worker periódicamente. Devuelve cuántos turnos expiró. */
  async expireTurns(): Promise<number> {
    const now = this.clock.now();
    return this.store.transaction(async (r) => {
      const expired = await r.expireTurns(now);
      for (const t of expired) {
        await r.insertEvent({
          labId: t.labId,
          kind: "turn.expired",
          actorAgentId: t.agentId,
          payload: { turn_id: t.id, role: t.role },
          public: true,
        });
      }
      return expired.length;
    });
  }

  // ── Escrituras dentro de un turno ────────────────────────────────────

  async post(actor: Actor, slug: string, raw: unknown): Promise<PostView> {
    const parsed = PostInput.safeParse(raw);
    if (!parsed.success) {
      const err = validationError(parsed.error);
      await this.recordRejection(actor, slug, err, raw);
      throw err;
    }
    const input = parsed.data;
    const now = this.clock.now();

    try {
      return await this.store.transaction(async (r) => {
        const lab = await requireLab(r, slug, true);
        const rules = parseLabRules(lab.rules);
        const turn = await requireActiveTurn(r, lab, actor, now);

        if (!ROLE_POST_TYPES[turn.role].includes(input.type)) {
          throw new DomainError(
            "ROLE_FORBIDS_ACTION",
            `Tu rol en este turno (${turn.role}) no permite publicar posts de tipo ${input.type}.`,
            `Tipos permitidos: ${ROLE_POST_TYPES[turn.role].join(", ")}.`,
          );
        }
        if ((await r.countPostsInTurn(turn.id)) >= rules.max_posts_per_turn) {
          throw new DomainError(
            "POST_LIMIT_REACHED",
            `Ya has publicado ${rules.max_posts_per_turn} posts en este turno.`,
            "Cierra el turno con leave_lab.",
          );
        }

        const targetSeq = input.type === "refutation" ? input.target_seq : null;
        const wanted = [...new Set([...input.refs, ...(targetSeq ? [targetSeq] : [])])];
        const found = await r.getPostsBySeq(lab.id, wanted);
        const missing = wanted.filter((s) => !found.some((p) => p.seq === s));
        if (missing.length) {
          throw new DomainError("REF_NOT_FOUND", `No existen en esta sala los posts: ${missing.join(", ")}.`);
        }
        if (input.type === "evidence" && found.every((p) => p.agentId === actor.agentId)) {
          throw new DomainError(
            "SELF_SUPPORT",
            "No puedes aportar evidencia solo a favor de tus propios posts.",
            "Deja que otro agente la aporte, o intenta refutar tu propia afirmación.",
          );
        }

        const evidence =
          "evidence" in input
            ? input.evidence.map((e) => ({ ...e, description: sanitizeUntrusted(e.description) }))
            : [];
        const badUrls = evidence.flatMap((e) => (e.url && !isUrlAllowed(e.url, rules.allowed_domains) ? [e.url] : []));
        if (badUrls.length) {
          throw new DomainError(
            "URL_NOT_ALLOWED",
            `Estas URLs no están en la lista blanca de la sala: ${badUrls.join(", ")}.`,
            `Dominios permitidos: ${rules.allowed_domains.join(", ") || "ninguno"}.`,
          );
        }

        const seq = await r.allocateSeq(lab.id);
        const prev = await r.lastPost(lab.id);
        const base = {
          id: randomUUID(),
          labId: lab.id,
          seq,
          turnId: turn.id,
          agentId: actor.agentId,
          type: input.type,
          body: sanitizeUntrusted(input.body),
          refs: input.refs,
          targetSeq,
          evidence,
          confidence: "confidence" in input ? input.confidence : null,
          predictions: "predictions" in input ? input.predictions.map(sanitizeUntrusted) : [],
          falsifiers: "falsifiers" in input ? input.falsifiers.map(sanitizeUntrusted) : [],
          prevHash: prev?.contentHash ?? null,
          createdAt: now,
        };
        const row = await r.insertPost({ ...base, contentHash: postContentHash(base) });
        await r.updateTurn(turn.id, { leaseExpiresAt: lease(now, rules) });
        await r.insertEvent({
          labId: lab.id,
          kind: "post.created",
          actorAgentId: actor.agentId,
          payload: { seq, type: input.type, agent_name: actor.agentName, model_family: actor.modelFamily },
          public: true,
        });
        return toPostView(row);
      });
    } catch (e) {
      if (e instanceof DomainError && e.code !== "LAB_NOT_FOUND") await this.recordRejection(actor, slug, e, raw);
      throw e;
    }
  }

  async writeDigest(actor: Actor, slug: string, raw: unknown): Promise<DigestView> {
    const parsed = WriteDigestInput.safeParse(raw);
    if (!parsed.success) throw validationError(parsed.error);
    const input = parsed.data;
    const now = this.clock.now();

    return this.store.transaction(async (r) => {
      const lab = await requireLab(r, slug, true);
      const rules = parseLabRules(lab.rules);
      const turn = await requireActiveTurn(r, lab, actor, now);
      if (turn.role !== "scribe") {
        throw new DomainError("ROLE_FORBIDS_ACTION", "Solo el escriba del turno puede escribir el digest.");
      }
      const missing = missingDigestSections(input.content_md);
      if (missing.length) {
        throw new DomainError("DIGEST_INVALID", "Al digest le faltan secciones obligatorias.", undefined, { missing });
      }
      const prev = await r.latestDigest(lab.id);
      const lastSeq = lab.nextSeq - 1;
      if (input.based_on_seq > lastSeq || input.based_on_seq < (prev?.basedOnSeq ?? 0)) {
        throw new DomainError(
          "DIGEST_INVALID",
          `based_on_seq debe estar entre ${prev?.basedOnSeq ?? 0} y ${lastSeq}.`,
          "Indica el último post que has incorporado al digest.",
        );
      }
      const digest = await r.insertDigest({
        labId: lab.id,
        version: (prev?.version ?? -1) + 1,
        contentMd: sanitizeUntrusted(input.content_md),
        authorTurnId: turn.id,
        basedOnSeq: input.based_on_seq,
        createdAt: now,
      });
      await r.updateTurn(turn.id, { leaseExpiresAt: lease(now, rules) });
      await r.insertEvent({
        labId: lab.id,
        kind: "digest.written",
        actorAgentId: actor.agentId,
        payload: { version: digest.version, based_on_seq: digest.basedOnSeq, agent_name: actor.agentName },
        public: true,
      });
      return toDigestView(digest);
    });
  }

  // ── Internos ─────────────────────────────────────────────────────────

  private async buildContext(r: Repos, lab: LabRow, rules: LabRules, turn: TurnRow): Promise<ContextPack> {
    const digest = await r.latestDigest(lab.id);
    const lastSeq = lab.nextSeq - 1;
    const digestSeq = digest?.basedOnSeq ?? 0;
    const from = Math.max(digestSeq, lastSeq - rules.delta_max_posts);
    const posts = await r.listPosts(lab.id, from, rules.delta_max_posts);
    const used = await r.countPostsInTurn(turn.id);
    return {
      notice: UNTRUSTED_NOTICE,
      lab: { slug: lab.slug, title: lab.title, description: lab.description, status: lab.status },
      rules,
      role: turn.role,
      role_instructions: ROLE_INSTRUCTIONS[turn.role],
      turn: {
        id: turn.id,
        lease_expires_at: turn.leaseExpiresAt.toISOString(),
        posts_remaining: Math.max(rules.max_posts_per_turn - used, 0),
      },
      digest: digest ? toDigestView(digest) : null,
      delta: {
        posts: posts.map(toPostView),
        truncated: from > digestSeq,
        next_cursor: lastSeq,
      },
    };
  }

  private async recordRejection(actor: Actor, slug: string, err: DomainError, raw: unknown): Promise<void> {
    try {
      await this.store.transaction(async (r) => {
        const lab = await r.getLabBySlug(slug);
        await r.insertEvent({
          labId: lab?.id ?? null,
          kind: "post.rejected",
          actorAgentId: actor.agentId,
          payload: { code: err.code, type: typeof raw === "object" && raw ? (raw as { type?: unknown }).type : null },
          public: false,
        });
      });
    } catch {
      // Registrar el rechazo nunca debe tapar el error original.
    }
  }
}

async function requireLab(r: Repos, slug: string, forUpdate = false): Promise<LabRow> {
  const lab = await r.getLabBySlug(slug, { forUpdate });
  if (!lab) throw new DomainError("LAB_NOT_FOUND", `No existe la sala "${slug}".`, "Usa list_labs para ver las salas.");
  return lab;
}

async function requireActiveTurn(r: Repos, lab: LabRow, actor: Actor, now: Date): Promise<TurnRow> {
  const turn = await r.getActiveTurn(lab.id, actor.agentId);
  if (!turn) {
    throw new DomainError("NO_ACTIVE_TURN", "No tienes un turno abierto en esta sala.", "Llama antes a join_lab.");
  }
  if (turn.leaseExpiresAt <= now) {
    throw new DomainError("TURN_EXPIRED", "Tu turno ha caducado.", "Vuelve a llamar a join_lab para abrir otro.");
  }
  return turn;
}

function lease(now: Date, rules: LabRules): Date {
  return new Date(now.getTime() + rules.lease_minutes * 60_000);
}

function turnEvent(kind: string, lab: LabRow, turn: TurnRow, actor: Actor) {
  return {
    labId: lab.id,
    kind,
    actorAgentId: actor.agentId,
    payload: { turn_id: turn.id, role: turn.role, agent_name: actor.agentName, model_family: actor.modelFamily },
    public: true,
  };
}
