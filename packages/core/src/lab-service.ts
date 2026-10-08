import {
  type ActiveTurnView,
  type ClaimView,
  type ContextPack,
  type DigestView,
  type LabRules,
  type LabSummary,
  type PostView,
  type PostsPage,
  type ProblemReview,
  type ProblemSummary,
  type ProblemView,
  type WaitResult,
  type WakeReason,
  PostInput,
  ProposeProblemInput,
  ROLE_POST_TYPES,
  ReviewProblemInput,
  RuleRefutationInput,
  type RulingResultView,
  CastVoteInput,
  type PollView,
  UNTRUSTED_NOTICE,
  WriteDigestInput,
  missingDigestSections,
  parseLabRules,
} from "@reagentlab/contracts";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import {
  applyPostToClaims,
  claimViews,
  contextClaims,
  eligibleRefutations,
  refutableClaims,
  refutationState,
  rulingTasks,
  settleRefutation,
  settleSilentRulings,
} from "./claim-ops.js";
import { applyRuling, rulingBlock } from "./claims.js";
import { closePoll, openDuePolls, openPollViews, pollViews } from "./poll-ops.js";
import { voteBlock, voteWeight } from "./polls.js";
import {
  problemDigestV0,
  slugifyTitle,
  toContextProblem,
  toProblemSummary,
  toProblemView,
} from "./problem-ops.js";
import { REPUTATION_POINTS } from "./reputation.js";
import { DomainError } from "./errors.js";
import { postContentHash } from "./hashing.js";
import { postSigningMessage, type Signer } from "./signing.js";
import type { Actor, Clock, EventRow, LabRow, PostRow, ProblemRow, Repos, Store, TurnRow } from "./ports.js";
import { systemClock } from "./ports.js";
import { ROLE_INSTRUCTIONS, assignRole } from "./roles.js";
import { isUrlAllowed, sanitizeUntrusted } from "./sanitize.js";
import { toDigestView, toPostView } from "./views.js";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Propuestas de problema pendientes por humano (ADR-0020). */
const MAX_PENDING_PROPOSALS = 3;
const CONTEXT_OTHER_PROBLEMS = 20;

/** Prioridad de los motivos para dar turno en un problema (menor = antes). */
const REASON_RANK: Record<WakeReason, number> = {
  open_turn: 0,
  reply_to_you: 1,
  scribe_needed: 2,
  ruling_needed: 3,
  vote_needed: 4,
  new_posts: 5,
  first_visit: 6,
};

function validationError(error: z.ZodError): DomainError {
  const issues = error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
  return new DomainError(
    "VALIDATION_FAILED",
    "La entrada no cumple el formato exigido.",
    "Corrige los campos indicados en `details` y vuelve a intentarlo.",
    issues,
  );
}

interface Pick {
  problem: ProblemRow;
  reason: WakeReason;
  repliesToYou: number[];
}

/**
 * Casos de uso de una sala. Es el ÚNICO sitio donde viven las reglas: REST y MCP
 * solo llaman aquí (ADR-0002). Desde ADR-0020, una sala es un área y el trabajo
 * (turnos, posts, digests, claims, polls) es siempre de un problema concreto.
 */
export class LabService {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock = systemClock,
    /** Firma del servidor (ADR-0009). Sin signer los posts se guardan sin firma. */
    private readonly signer?: Signer,
  ) {}

  // ── Lecturas públicas ────────────────────────────────────────────────

  async listLabs(): Promise<LabSummary[]> {
    const now = this.clock.now();
    return this.store.read(async (r) => Promise.all((await r.listLabs()).map((l) => labSummary(r, l, now))));
  }

  async getLab(slug: string): Promise<{
    lab: LabSummary;
    rules: LabRules;
    /** Ficha de la sala (digest v0 sin problema). */
    digest: DigestView | null;
    problems: ProblemSummary[];
    last_event_id: number;
  }> {
    const now = this.clock.now();
    return this.store.read(async (r) => {
      const lab = await requireLab(r, slug);
      const charter = await r.latestDigest(lab.id, null);
      return {
        lab: await labSummary(r, lab, now),
        rules: parseLabRules(lab.rules),
        digest: charter ? toDigestView(charter) : null,
        problems: await problemSummaries(r, lab.id, ["active"]),
        last_event_id: await r.latestPublicEventId(lab.id),
      };
    });
  }

  async getLabRules(slug: string): Promise<LabRules> {
    return this.store.read(async (r) => parseLabRules((await requireLab(r, slug)).rules));
  }

  /** Problemas de la sala. Por defecto solo los activos; los propuestos los ven los administradores. */
  async listProblems(slug: string, reviews: ProblemReview[] = ["active"]): Promise<ProblemView[]> {
    return this.store.read(async (r) => {
      const lab = await requireLab(r, slug);
      const rows = await r.listProblems(lab.id, reviews);
      const stats = await r.problemStats(lab.id);
      return Promise.all(
        rows.map(async (p) =>
          toProblemView(
            p,
            lab.slug,
            stats.find((s) => s.problemId === p.id),
            p.proposedByUserId ? await r.getUserHandle(p.proposedByUserId) : null,
          ),
        ),
      );
    });
  }

  async getProblem(slug: string, problemSlug: string): Promise<{ problem: ProblemView; digest: DigestView | null }> {
    return this.store.read(async (r) => {
      const lab = await requireLab(r, slug);
      const p = await requireProblem(r, lab, problemSlug);
      const stats = (await r.problemStats(lab.id)).find((s) => s.problemId === p.id);
      const digest = await r.latestDigest(lab.id, p.id);
      return {
        problem: toProblemView(p, lab.slug, stats, p.proposedByUserId ? await r.getUserHandle(p.proposedByUserId) : null),
        digest: digest ? toDigestView(digest) : null,
      };
    });
  }

  /** Posts de la sala (o de un problema), en orden, a partir de `cursor`. */
  async readPosts(slug: string, cursor = 0, limit = 20, problemSlug?: string): Promise<PostsPage> {
    const lim = Math.min(Math.max(limit, 1), 100);
    return this.store.read(async (r) => {
      const lab = await requireLab(r, slug);
      const problem = problemSlug ? await requireProblem(r, lab, problemSlug) : null;
      const rows = await r.listPosts(lab.id, cursor, lim + 1, problem?.id);
      const page = rows.slice(0, lim);
      return {
        notice: UNTRUSTED_NOTICE,
        posts: page.map(toPostView),
        next_cursor: page.at(-1)?.seq ?? cursor,
        has_more: rows.length > lim,
      };
    });
  }

  /** Claims de la sala (o de un problema), refutados incluidos, los más recientes primero. */
  async listClaims(slug: string, problemSlug?: string, limit = 100): Promise<ClaimView[]> {
    return this.store.read(async (r) => {
      const lab = await requireLab(r, slug);
      const problem = problemSlug ? await requireProblem(r, lab, problemSlug) : null;
      return claimViews(
        r,
        await r.listClaimDetails(lab.id, { problemId: problem?.id, limit: Math.min(Math.max(limit, 1), 500) }),
      );
    });
  }

  /** Polls de la sala (o de un problema). Votos y recuento solo cuando el poll está cerrado (ADR-0011). */
  async listPolls(slug: string, problemSlug?: string, limit = 50): Promise<PollView[]> {
    return this.store.read(async (r) => {
      const lab = await requireLab(r, slug);
      const problem = problemSlug ? await requireProblem(r, lab, problemSlug) : null;
      const rows = await r.listPolls(lab.id, { problemId: problem?.id, limit: Math.min(Math.max(limit, 1), 200) });
      return pollViews(r, lab.id, rows, true);
    });
  }

  /** Quién está trabajando ahora mismo en la sala, en qué problema y con qué rol. */
  async listActiveTurns(slug: string): Promise<ActiveTurnView[]> {
    const now = this.clock.now();
    return this.store.read(async (r) => {
      const lab = await requireLab(r, slug);
      const slugs = new Map((await r.listProblems(lab.id)).map((p) => [p.id, p.slug]));
      const rows = await r.listActiveTurns(lab.id, now);
      return rows.map((t) => {
        const v: ActiveTurnView = {
          agent: { name: t.agentName, model_family: t.modelFamily },
          role: t.role,
          started_at: t.startedAt.toISOString(),
          lease_expires_at: t.leaseExpiresAt.toISOString(),
        };
        const problem = t.problemId ? slugs.get(t.problemId) : undefined;
        if (problem) v.problem = problem;
        return v;
      });
    });
  }

  async listPublicEvents(slug: string, afterId = 0, limit = 100): Promise<EventRow[]> {
    return this.store.read(async (r) => {
      const lab = await requireLab(r, slug);
      return r.listPublicEvents(lab.id, afterId, Math.min(limit, 500));
    });
  }

  // ── Problemas: propuesta y revisión (ADR-0020) ───────────────────────

  /**
   * Propone un problema nuevo en una sala. Lo puede hacer un humano desde la web o un
   * agente; queda `proposed` hasta que un administrador lo apruebe.
   */
  async proposeProblem(
    proposer: { userId: string; agentId?: string },
    slug: string,
    raw: unknown,
  ): Promise<ProblemView> {
    const parsed = ProposeProblemInput.safeParse(raw);
    if (!parsed.success) throw validationError(parsed.error);
    const input = parsed.data;
    const now = this.clock.now();

    return this.store.transaction(async (r) => {
      const lab = await requireLab(r, slug, true);
      const rules = parseLabRules(lab.rules);
      const problemSlug = input.slug ?? slugifyTitle(input.title);
      if (problemSlug.length < 2) {
        throw new DomainError("VALIDATION_FAILED", "No se puede derivar un slug de ese título.", "Indica `slug` a mano.");
      }
      if (await r.getProblem(lab.id, problemSlug)) {
        throw new DomainError(
          "PROBLEM_EXISTS",
          `Ya hay un problema "${problemSlug}" en la sala.`,
          "Si es el mismo problema, trabaja en él; si es otro, elige otro slug.",
        );
      }
      if (input.source_url && !isUrlAllowed(input.source_url, rules.allowed_domains)) {
        throw new DomainError(
          "URL_NOT_ALLOWED",
          `La fuente no está en la lista blanca de la sala: ${input.source_url}.`,
          `Dominios permitidos: ${rules.allowed_domains.join(", ") || "ninguno"}.`,
        );
      }
      if ((await r.countPendingProposals(proposer.userId)) >= MAX_PENDING_PROPOSALS) {
        throw new DomainError(
          "PROPOSAL_LIMIT",
          `Ya tienes ${MAX_PENDING_PROPOSALS} problemas propuestos pendientes de revisión.`,
          "Espera a que se revisen antes de proponer más.",
        );
      }
      const problem = await r.insertProblem({
        labId: lab.id,
        slug: problemSlug,
        title: sanitizeUntrusted(input.title),
        statement: sanitizeUntrusted(input.statement),
        sourceUrl: input.source_url ?? null,
        review: "proposed",
        status: "red",
        proposedByUserId: proposer.userId,
        proposedByAgentId: proposer.agentId ?? null,
        reviewNote: null,
        reviewedAt: null,
        createdAt: now,
      });
      await r.insertEvent({
        labId: lab.id,
        kind: "problem.proposed",
        actorAgentId: proposer.agentId ?? null,
        payload: { problem: problem.slug },
        public: false,
      });
      return toProblemView(problem, lab.slug, undefined, await r.getUserHandle(proposer.userId));
    });
  }

  /**
   * Aprueba, rechaza o archiva un problema. Quién puede hacerlo (administradores) lo
   * decide el adaptador; aquí van las transiciones y sus efectos.
   */
  async reviewProblem(slug: string, problemSlug: string, raw: unknown): Promise<ProblemView> {
    const parsed = ReviewProblemInput.safeParse(raw);
    if (!parsed.success) throw validationError(parsed.error);
    const { decision, note } = parsed.data;
    const now = this.clock.now();

    return this.store.transaction(async (r) => {
      const lab = await requireLab(r, slug, true);
      const problem = await requireProblem(r, lab, problemSlug);
      const allowed =
        (decision === "archive" && problem.review === "active") ||
        (decision !== "archive" && problem.review === "proposed");
      if (!allowed) {
        throw new DomainError(
          "PROBLEM_NOT_ACTIVE",
          `No se puede ${decision} un problema en estado ${problem.review}.`,
          "Se aprueban o rechazan los propuestos; se archivan los activos.",
        );
      }
      const review = decision === "approve" ? "active" : decision === "reject" ? "rejected" : "archived";
      await r.updateProblem(problem.id, { review, reviewNote: note ?? null, reviewedAt: now });
      if (decision === "approve") await openProblem(r, lab, problem, now);
      else {
        await r.insertEvent({
          labId: lab.id,
          kind: `problem.${review}`,
          actorAgentId: null,
          payload: { problem: problem.slug },
          public: decision === "archive",
        });
      }
      const updated = (await r.getProblemById(problem.id))!;
      return toProblemView(updated, lab.slug, undefined, updated.proposedByUserId ? await r.getUserHandle(updated.proposedByUserId) : null);
    });
  }

  // ── Turnos ───────────────────────────────────────────────────────────

  /**
   * Entra en la sala como residente y abre un turno en un problema (o devuelve el que
   * ya está abierto, renovando el lease). Si no se elige problema, lo escoge el servidor
   * (ADR-0020). Entrega el paquete de contexto de ese problema: digest + delta (ADR-0006).
   */
  async joinLab(actor: Actor, slug: string, problemSlug?: string): Promise<ContextPack> {
    const now = this.clock.now();
    return this.store.transaction(async (r) => {
      const { lab, rules } = await this.enterLab(r, actor, slug, now);
      const open = await this.renewTurn(r, lab, rules, actor, now);
      if (open) return this.buildContext(r, lab, rules, open, actor);
      const pick = problemSlug
        ? { problem: await requireWorkableProblem(r, lab, problemSlug) }
        : ((await this.pickProblem(r, lab, rules, actor, now)) ?? { problem: await leastAttended(r, lab) });
      const turn = await this.openTurn(r, lab, rules, actor, now, pick.problem);
      return this.buildContext(r, lab, rules, turn, actor);
    });
  }

  /**
   * Una comprobación de `wait_for_turn` (ADR-0015): si hay motivo para que este residente
   * participe ahora en algún problema (o en el que pide), le abre turno; si no, `idle`.
   */
  async checkWake(actor: Actor, slug: string, problemSlug?: string): Promise<WaitResult> {
    const now = this.clock.now();
    return this.store.transaction(async (r) => {
      const { lab, rules } = await this.enterLab(r, actor, slug, now);

      const open = await this.renewTurn(r, lab, rules, actor, now);
      if (open) return this.wakeWith(r, lab, rules, open, actor, "open_turn", []);

      const only = problemSlug ? await requireWorkableProblem(r, lab, problemSlug) : undefined;
      const pick = await this.pickProblem(r, lab, rules, actor, now, only);
      if (!pick) return idle(only ? `No hay nada nuevo para ti en "${only.slug}".` : "No hay nada nuevo para ti en la sala.");

      const blocked = await turnBlocker(r, lab, rules, actor, now);
      if (blocked) return idle(blocked.message);

      if (pick.reason === "new_posts" && !(await this.isNextInLine(r, lab, rules, actor, now))) {
        return idle("Hay posts nuevos, pero otro residente lleva más tiempo esperando turno.");
      }

      const turn = await this.openTurn(r, lab, rules, actor, now, pick.problem);
      return this.wakeWith(r, lab, rules, turn, actor, pick.reason, pick.repliesToYou);
    });
  }

  /**
   * Espera hasta que haya turno o venza el plazo (long-poll). Vuelve a comprobar cada
   * `pollMs`, o antes si `nextChange` avisa de un evento en la sala (LISTEN/NOTIFY);
   * `signal` corta la espera si el cliente se desconecta.
   */
  async waitForTurn(
    actor: Actor,
    slug: string,
    opts: {
      signal?: AbortSignal;
      pollMs?: number;
      maxSeconds?: number;
      nextChange?: (ms: number, signal?: AbortSignal) => Promise<void>;
      problem?: string;
    } = {},
  ): Promise<WaitResult> {
    const rules = await this.getLabRules(slug);
    const maxMs = Math.min(opts.maxSeconds ?? rules.wait_max_seconds, rules.wait_max_seconds) * 1000;
    const pollMs = opts.pollMs ?? 2000;
    const deadline = Date.now() + maxMs;
    const wait = opts.nextChange ?? sleep;
    for (;;) {
      const res = await this.checkWake(actor, slug, opts.problem);
      const left = deadline - Date.now();
      if (res.status === "turn" || opts.signal?.aborted || left <= 0) return res;
      await wait(Math.min(pollMs, left), opts.signal);
    }
  }

  /** Cierra el turno abierto. El agente sigue en la sala como residente. */
  async endTurn(actor: Actor, slug: string): Promise<{ turn_id: string; status: "closed" }> {
    const now = this.clock.now();
    return this.store.transaction(async (r) => {
      const lab = await requireLab(r, slug);
      const turn = await r.getActiveTurn(lab.id, actor.agentId);
      if (!turn) throw new DomainError("NO_ACTIVE_TURN", "No tienes un turno abierto en esta sala.");
      await r.updateTurn(turn.id, { status: "closed", endedAt: now });
      await settleSilentRulings(r, lab, turn, now);
      await r.touchMembership(lab.id, actor.agentId, now);
      await r.insertEvent(await turnEvent(r, "turn.ended", lab, turn, actor));
      return { turn_id: turn.id, status: "closed" as const };
    });
  }

  /** Sale de la sala: cierra el turno si lo hay y deja de ser residente. */
  async leaveLab(actor: Actor, slug: string): Promise<{ status: "left"; closed_turn_id: string | null }> {
    const now = this.clock.now();
    return this.store.transaction(async (r) => {
      const lab = await requireLab(r, slug);
      const turn = await r.getActiveTurn(lab.id, actor.agentId);
      if (turn) {
        await r.updateTurn(turn.id, { status: "closed", endedAt: now });
        await settleSilentRulings(r, lab, turn, now);
        await r.insertEvent(await turnEvent(r, "turn.ended", lab, turn, actor));
      }
      await r.leaveMembership(lab.id, actor.agentId, now);
      await r.insertEvent({
        labId: lab.id,
        kind: "member.left",
        actorAgentId: actor.agentId,
        payload: { agent_name: actor.agentName, model_family: actor.modelFamily },
        public: true,
      });
      return { status: "left" as const, closed_turn_id: turn?.id ?? null };
    });
  }

  /** Lo llama el worker periódicamente. Devuelve cuántos turnos expiró. */
  async expireTurns(): Promise<number> {
    const now = this.clock.now();
    return this.store.transaction(async (r) => {
      const expired = await r.expireTurns(now);
      for (const t of expired) {
        await settleSilentRulings(r, { id: t.labId }, t, now);
        await r.insertEvent({
          labId: t.labId,
          kind: "turn.expired",
          actorAgentId: t.agentId,
          payload: { turn_id: t.id, role: t.role, problem: await problemSlugOf(r, t.problemId) },
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
        const { turn, problem } = await requireProblemTurn(r, lab, actor, now);

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
            "Cierra el turno con end_turn.",
          );
        }

        const targetSeq = input.type === "refutation" ? input.target_seq : null;
        const wanted = [...new Set([...input.refs, ...(targetSeq ? [targetSeq] : [])])];
        const found = (await r.getPostsBySeq(lab.id, wanted)).filter((p) => p.problemId === problem.id);
        const missing = wanted.filter((s) => !found.some((p) => p.seq === s));
        if (missing.length) {
          throw new DomainError(
            "REF_NOT_FOUND",
            `No existen en el problema "${problem.slug}" los posts: ${missing.join(", ")}.`,
            "Solo se citan posts del problema de tu turno.",
          );
        }
        // Responder a algo reciente del problema (ADR-0015, por problema desde ADR-0020).
        const recent = await r.listRecentProblemPosts(problem.id, rules.delta_max_posts);
        if (turn.role !== "scribe" && recent.length && !wanted.some((s) => recent.some((p) => p.seq === s))) {
          throw new DomainError(
            "MUST_REPLY",
            "Cada post tiene que responder a algo reciente del problema.",
            `Incluye en refs (o en target_seq si refutas) al menos uno de estos posts: ${recent.map((p) => p.seq).join(", ")}.`,
            { recent: recent.map((p) => ({ seq: p.seq, type: p.type, agent: p.agentName })) },
          );
        }
        // Refutar una derivación es señalar el paso que falla (ADR-0019).
        const targetStep = input.type === "refutation" ? (input.target_step ?? null) : null;
        if (input.type === "refutation") {
          const target = found.find((p) => p.seq === input.target_seq)!;
          const steps = target.claimKind === "derivation" ? target.steps.length : 0;
          if (steps && (targetStep === null || targetStep > steps)) {
            throw new DomainError(
              "STEP_REQUIRED",
              `El post ${target.seq} es una derivación de ${steps} pasos: indica en target_step cuál falla (1-${steps}).`,
              "Ataca un paso concreto del argumento y explica por qué no se sigue de los anteriores.",
            );
          }
          if (!steps && targetStep !== null) {
            throw new DomainError(
              "VALIDATION_FAILED",
              `El post ${target.seq} no es una derivación con pasos: quita target_step.`,
            );
          }
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
        const isHypothesis = input.type === "hypothesis";
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
          problemId: problem.id,
          turnId: turn.id,
          agentId: actor.agentId,
          type: input.type,
          body: sanitizeUntrusted(input.body),
          refs: input.refs,
          targetSeq,
          targetStep,
          claimKind: isHypothesis ? input.claim_kind : null,
          steps: isHypothesis ? input.steps.map(sanitizeUntrusted) : [],
          evidence,
          confidence: "confidence" in input ? input.confidence : null,
          predictions: "predictions" in input ? input.predictions.map(sanitizeUntrusted) : [],
          falsifiers: "falsifiers" in input ? input.falsifiers.map(sanitizeUntrusted) : [],
          prevHash: prev?.contentHash ?? null,
          createdAt: now,
        };
        // El problema no entra en el hash: la cadena es de la sala y los posts antiguos no lo tienen.
        const contentHash = postContentHash(base);
        const row = await r.insertPost({
          ...base,
          contentHash,
          serverSig: this.signer?.sign(postSigningMessage(contentHash)) ?? null,
          sigKeyId: this.signer?.keyId ?? null,
        });
        await applyPostToClaims(r, lab, actor, row, found, now);
        await r.updateTurn(turn.id, { leaseExpiresAt: lease(now, rules) });
        await r.insertEvent({
          labId: lab.id,
          kind: "post.created",
          actorAgentId: actor.agentId,
          payload: {
            seq,
            type: input.type,
            problem: problem.slug,
            agent_name: actor.agentName,
            model_family: actor.modelFamily,
          },
          public: true,
        });
        return toPostView({ ...row, problemSlug: problem.slug });
      });
    } catch (e) {
      if (e instanceof DomainError && e.code !== "LAB_NOT_FOUND") await this.recordRejection(actor, slug, e, raw);
      throw e;
    }
  }

  /**
   * Dictamen de un verificador sobre una refutación (ADR-0008, ADR-0016). El primero
   * queda provisional; un segundo verificador lo confirma (firme) o lo contradice
   * (disputa, que resolverá un poll). Solo refutaciones del problema del turno.
   */
  async ruleRefutation(actor: Actor, slug: string, raw: unknown): Promise<RulingResultView> {
    const parsed = RuleRefutationInput.safeParse(raw);
    if (!parsed.success) throw validationError(parsed.error);
    const input = parsed.data;
    const now = this.clock.now();

    return this.store.transaction(async (r) => {
      const lab = await requireLab(r, slug, true);
      const rules = parseLabRules(lab.rules);
      const { turn, problem } = await requireProblemTurn(r, lab, actor, now);
      if (turn.role !== "verifier") {
        throw new DomainError(
          "ROLE_FORBIDS_ACTION",
          "Solo el verificador del turno puede dictaminar refutaciones.",
          "Espera a que el servidor te asigne el rol de verificador (wait_for_turn).",
        );
      }
      const ref = await r.getRefutationBySeq(lab.id, input.refutation_seq);
      const [claim] = ref ? await r.getClaimsBySeq(lab.id, [ref.claimSeq]) : [];
      if (!ref || !claim || claim.problemId !== problem.id) {
        throw new DomainError(
          "REFUTATION_NOT_FOUND",
          `El post ${input.refutation_seq} no es una refutación de un claim del problema "${problem.slug}".`,
          "Usa el seq de un post de `rulings_needed` en tu paquete de contexto.",
        );
      }
      const state = refutationState(ref, claim);
      const block = claim.status === "refuted" ? "closed" : rulingBlock(state, actor.userId);
      if (block === "closed") {
        throw new DomainError("REFUTATION_CLOSED", `La refutación ${ref.postSeq} ya no admite dictámenes (${ref.status}).`);
      }
      if (block) {
        throw new DomainError(
          "CONFLICT_OF_INTEREST",
          block === "already_ruled"
            ? "Tu humano ya dio el dictamen provisional de esta refutación."
            : "No puedes dictaminar una refutación en la que tu humano es el refutador o el autor del claim.",
        );
      }

      const reasoning = sanitizeUntrusted(input.reasoning);
      const outcome = applyRuling(state, actor.userId, input.verdict);
      await r.insertRuling({
        refutationId: ref.id,
        turnId: turn.id,
        agentId: actor.agentId,
        userId: actor.userId,
        verdict: input.verdict,
        reasoning,
        createdAt: now,
      });
      const base = {
        refutation_seq: ref.postSeq,
        claim_seq: ref.claimSeq,
        problem: problem.slug,
        agent_name: actor.agentName,
        model_family: actor.modelFamily,
      };
      if (outcome.kind === "provisional") {
        await r.updateRefutation(ref.id, {
          status: "ruled",
          provisionalVerdict: outcome.verdict,
          provisionalAgentId: actor.agentId,
          provisionalUserId: actor.userId,
          provisionalReasoning: reasoning,
          ruledAt: now,
        });
        await r.insertEvent({
          labId: lab.id,
          kind: "refutation.ruled",
          actorAgentId: actor.agentId,
          payload: { ...base, verdict: outcome.verdict },
          public: true,
        });
      } else if (outcome.kind === "final") {
        await settleRefutation(r, lab, ref, outcome.status, outcome.verdict, now, actor.agentId, "confirmed");
      } else {
        await r.updateRefutation(ref.id, { status: "disputed" });
        await r.insertEvent({ labId: lab.id, kind: "refutation.disputed", actorAgentId: actor.agentId, payload: base, public: true });
      }
      await r.updateTurn(turn.id, { leaseExpiresAt: lease(now, rules) });

      const [detail] = await r.listClaimDetails(lab.id, { seqs: [ref.claimSeq], limit: 1 });
      const [claimView] = await claimViews(r, detail ? [detail] : []);
      return { refutation_seq: ref.postSeq, refutation_status: outcome.status, claim: claimView! };
    });
  }

  /** Voto a ciegas en un poll abierto del problema del turno (ADR-0011): uno por humano. */
  async castVote(actor: Actor, slug: string, raw: unknown): Promise<{ poll_id: string; status: "recorded" }> {
    const parsed = CastVoteInput.safeParse(raw);
    if (!parsed.success) throw validationError(parsed.error);
    const input = parsed.data;
    const now = this.clock.now();

    return this.store.transaction(async (r) => {
      const lab = await requireLab(r, slug, true);
      const rules = parseLabRules(lab.rules);
      const { turn, problem } = await requireProblemTurn(r, lab, actor, now);
      const poll = await r.getPoll(input.poll_id);
      if (!poll || poll.labId !== lab.id || poll.problemId !== problem.id) {
        throw new DomainError(
          "POLL_NOT_FOUND",
          `No hay ningún poll con ese id en el problema "${problem.slug}".`,
          "Usa un id de `open_polls`.",
        );
      }
      if (poll.status !== "open" || poll.closesAt <= now) {
        throw new DomainError("POLL_CLOSED", "El poll ya está cerrado.");
      }
      const block = voteBlock(poll.partyUserIds, actor.userId, await r.hasVoted(poll.id, actor.userId));
      if (block === "party_to_the_case") {
        throw new DomainError("CONFLICT_OF_INTEREST", "Tu humano es parte de este caso y no puede votar en él.");
      }
      const inserted =
        !block &&
        (await r.insertVote({
          pollId: poll.id,
          agentId: actor.agentId,
          userId: actor.userId,
          modelFamily: actor.modelFamily,
          stance: input.stance,
          reasoning: sanitizeUntrusted(input.reasoning),
          weight: voteWeight(await r.getUserReputation(actor.userId)),
          createdAt: now,
        }));
      if (!inserted) {
        throw new DomainError("ALREADY_VOTED", "Tu humano ya ha votado en este poll (un voto por humano, ADR-0011).");
      }
      await r.updateTurn(turn.id, { leaseExpiresAt: lease(now, rules) });
      // El evento no lleva la postura: el voto es a ciegas hasta el cierre.
      await r.insertEvent({
        labId: lab.id,
        kind: "poll.vote_cast",
        actorAgentId: actor.agentId,
        payload: { poll_id: poll.id, problem: problem.slug, agent_name: actor.agentName, model_family: actor.modelFamily },
        public: true,
      });
      return { poll_id: poll.id, status: "recorded" as const };
    });
  }

  /**
   * Lo llama el worker: cierra los polls vencidos y abre los que tocan en cada sala.
   * Cada sala va en su propia transacción.
   */
  async runPolls(): Promise<{ closed: number; opened: number }> {
    const now = this.clock.now();
    const labs = await this.store.read((r) => r.listLabs());
    let closed = 0;
    let opened = 0;
    for (const l of labs) {
      await this.store.transaction(async (r) => {
        const lab = (await r.getLabBySlug(l.slug, { forUpdate: true }))!;
        const rules = parseLabRules(lab.rules);
        for (const poll of (await r.listDuePolls(now)).filter((p) => p.labId === lab.id)) {
          await closePoll(r, lab, rules, poll, now);
          closed++;
        }
        opened += await openDuePolls(r, lab, rules, now);
      });
    }
    return { closed, opened };
  }

  /** El escriba reescribe el digest del problema de su turno. */
  async writeDigest(actor: Actor, slug: string, raw: unknown): Promise<DigestView> {
    const parsed = WriteDigestInput.safeParse(raw);
    if (!parsed.success) throw validationError(parsed.error);
    const input = parsed.data;
    const now = this.clock.now();

    return this.store.transaction(async (r) => {
      const lab = await requireLab(r, slug, true);
      const rules = parseLabRules(lab.rules);
      const { turn, problem } = await requireProblemTurn(r, lab, actor, now);
      if (turn.role !== "scribe") {
        throw new DomainError("ROLE_FORBIDS_ACTION", "Solo el escriba del turno puede escribir el digest.");
      }
      const missing = missingDigestSections(input.content_md);
      if (missing.length) {
        throw new DomainError("DIGEST_INVALID", "Al digest le faltan secciones obligatorias.", undefined, { missing });
      }
      const prev = await r.latestDigest(lab.id, problem.id);
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
        problemId: problem.id,
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
        payload: {
          version: digest.version,
          based_on_seq: digest.basedOnSeq,
          problem: problem.slug,
          agent_name: actor.agentName,
        },
        public: true,
      });
      return toDigestView(digest);
    });
  }

  // ── Internos ─────────────────────────────────────────────────────────

  /** Comprueba la sala, caduca turnos vencidos y apunta al agente como residente. */
  private async enterLab(r: Repos, actor: Actor, slug: string, now: Date): Promise<{ lab: LabRow; rules: LabRules }> {
    const lab = await requireLab(r, slug, true);
    const rules = parseLabRules(lab.rules);
    // Expira antes los turnos vencidos de la sala: liberan plaza y el puesto de escriba.
    for (const t of await r.expireTurns(now, lab.id)) {
      await settleSilentRulings(r, lab, t, now);
      await r.insertEvent({
        labId: lab.id,
        kind: "turn.expired",
        actorAgentId: t.agentId,
        payload: { turn_id: t.id, role: t.role, problem: await problemSlugOf(r, t.problemId) },
        public: true,
      });
    }
    await r.touchMembership(lab.id, actor.agentId, now);
    return { lab, rules };
  }

  /** Si el agente tiene turno abierto, renueva su lease y lo devuelve. */
  private async renewTurn(r: Repos, lab: LabRow, rules: LabRules, actor: Actor, now: Date): Promise<TurnRow | null> {
    const turn = await r.getActiveTurn(lab.id, actor.agentId);
    if (!turn) return null;
    const leaseExpiresAt = lease(now, rules);
    await r.updateTurn(turn.id, { leaseExpiresAt });
    return { ...turn, leaseExpiresAt };
  }

  private async openTurn(
    r: Repos,
    lab: LabRow,
    rules: LabRules,
    actor: Actor,
    now: Date,
    problem: ProblemRow,
  ): Promise<TurnRow> {
    const blocked = await turnBlocker(r, lab, rules, actor, now);
    if (blocked) throw blocked;
    const role = assignRole(
      await this.roleInput(r, lab, rules, actor, now, problem),
      await r.lastTurnRole(lab.id, actor.agentId),
    );
    const turn = await r.insertTurn({
      labId: lab.id,
      agentId: actor.agentId,
      problemId: problem.id,
      role,
      status: "active",
      leaseExpiresAt: lease(now, rules),
      contextSeq: lab.nextSeq - 1,
      startedAt: now,
      endedAt: null,
    });
    await r.insertEvent(await turnEvent(r, "turn.started", lab, turn, actor));
    return turn;
  }

  private async roleInput(r: Repos, lab: LabRow, rules: LabRules, actor: Actor, now: Date, problem: ProblemRow) {
    const digest = await r.latestDigest(lab.id, problem.id);
    return {
      postsSinceDigest: await r.countProblemPostsAfter(problem.id, digest?.basedOnSeq ?? 0),
      digestStaleAfter: rules.digest_stale_after_posts,
      hasActiveScribe: await r.hasActiveScribe(problem.id, now),
      rulingsAvailable: (await eligibleRefutations(r, lab.id, actor.userId, problem.id)).length,
      refutableClaims: await refutableClaims(r, lab.id, rules, actor.userId, problem.id),
    };
  }

  /**
   * ¿En qué problema tiene este agente algo que hacer ahora? Mira cada problema activo
   * (o solo `only`) y se queda con el motivo de más prioridad; a igualdad, el problema
   * que lleva más tiempo sin turnos (ADR-0020). Null si no hay motivo en ninguno.
   */
  private async pickProblem(
    r: Repos,
    lab: LabRow,
    rules: LabRules,
    actor: Actor,
    now: Date,
    only?: ProblemRow,
  ): Promise<Pick | null> {
    const problems = only ? [only] : await workableProblems(r, lab.id);
    if (!problems.length) {
      if (only) return null;
      throw new DomainError(
        "NO_ACTIVE_PROBLEMS",
        `La sala "${lab.slug}" no tiene problemas activos.`,
        "Propón uno con propose_problem; un administrador lo revisará.",
      );
    }
    const stats = await r.problemStats(lab.id);
    const lastTurnAt = (p: ProblemRow) => stats.find((s) => s.problemId === p.id)?.lastTurnAt?.getTime() ?? 0;

    const lastInLab = await r.lastTurn(lab.id, actor.agentId);
    if (!lastInLab) {
      const first = [...problems].sort((a, b) => lastTurnAt(a) - lastTurnAt(b))[0]!;
      return { problem: first, reason: "first_visit", repliesToYou: [] };
    }

    const mine = await r.listPostSeqsByAgent(lab.id, actor.agentId);
    const mineSet = new Set(mine);
    const seenInLab = Math.max(lastInLab.contextSeq, mine.at(-1) ?? 0);
    const candidates: Pick[] = [];
    for (const problem of problems) {
      const lastHere = await r.lastTurnInProblem(problem.id, actor.agentId);
      const fresh = (await listAllAfter(r, lab.id, Math.min(seenInLab, lastHere?.contextSeq ?? seenInLab), problem.id)).filter(
        (p) => p.agentId !== actor.agentId,
      );
      // `fresh` ya empieza donde el agente dejó de ver este problema.
      const replies = fresh.filter(
        (p) => p.refs.some((s) => mineSet.has(s)) || (p.targetSeq !== null && mineSet.has(p.targetSeq)),
      );
      if (replies.length) {
        candidates.push({ problem, reason: "reply_to_you", repliesToYou: replies.map((p) => p.seq) });
        continue;
      }
      const role = assignRole(await this.roleInput(r, lab, rules, actor, now, problem), lastInLab.role);
      if (role === "scribe") candidates.push({ problem, reason: "scribe_needed", repliesToYou: [] });
      else if (role === "verifier") candidates.push({ problem, reason: "ruling_needed", repliesToYou: [] });
      else if ((await openPollViews(r, lab.id, actor.userId, now, problem.id)).some((p) => p.you_can_vote)) {
        candidates.push({ problem, reason: "vote_needed", repliesToYou: [] });
      } else if (fresh.length >= rules.new_posts_to_wake) {
        candidates.push({ problem, reason: "new_posts", repliesToYou: [] });
      }
    }
    candidates.sort((a, b) => REASON_RANK[a.reason] - REASON_RANK[b.reason] || lastTurnAt(a.problem) - lastTurnAt(b.problem));
    return candidates[0] ?? null;
  }

  /** Equidad: entre los residentes en espera sin turno, ¿está este agente entre los que más llevan sin uno? */
  private async isNextInLine(r: Repos, lab: LabRow, rules: LabRules, actor: Actor, now: Date): Promise<boolean> {
    // "En espera" = ha dado señales en el último par de ventanas de long-poll.
    const waitingSince = new Date(now.getTime() - 2 * rules.wait_max_seconds * 1000 - 5000);
    const active = new Set((await r.listActiveTurns(lab.id, now)).map((t) => t.agentId));
    const queue = (await r.listResidentsLastTurn(lab.id, waitingSince))
      .filter((m) => !active.has(m.agentId))
      .sort((a, b) => (a.lastTurnAt?.getTime() ?? 0) - (b.lastTurnAt?.getTime() ?? 0) || a.agentId.localeCompare(b.agentId));
    const free = rules.max_active_turns - active.size;
    return queue.slice(0, Math.max(free, 0)).some((m) => m.agentId === actor.agentId);
  }

  private async wakeWith(
    r: Repos,
    lab: LabRow,
    rules: LabRules,
    turn: TurnRow,
    actor: Actor,
    reason: WakeReason,
    repliesToYou: number[],
  ): Promise<WaitResult> {
    return {
      status: "turn",
      reason,
      replies_to_you: repliesToYou,
      context: await this.buildContext(r, lab, rules, turn, actor),
    };
  }

  /** Paquete de contexto del problema del turno: enunciado, digest, delta y tareas (ADR-0006, ADR-0020). */
  private async buildContext(r: Repos, lab: LabRow, rules: LabRules, turn: TurnRow, actor: Actor): Promise<ContextPack> {
    const problem = await problemOfTurn(r, turn);
    const digest = await r.latestDigest(lab.id, problem.id);
    const digestSeq = digest?.basedOnSeq ?? 0;
    const since = await r.countProblemPostsAfter(problem.id, digestSeq);
    const truncated = since > rules.delta_max_posts;
    const posts = truncated
      ? await r.listRecentProblemPosts(problem.id, rules.delta_max_posts)
      : await r.listPosts(lab.id, digestSeq, rules.delta_max_posts, problem.id);
    const used = await r.countPostsInTurn(turn.id);
    const now = this.clock.now();
    const others = (await problemSummaries(r, lab.id, ["active"]))
      .filter((p) => p.slug !== problem.slug)
      .slice(0, CONTEXT_OTHER_PROBLEMS);
    return {
      notice: UNTRUSTED_NOTICE,
      lab: { slug: lab.slug, title: lab.title, description: lab.description, status: lab.status },
      rules,
      problem: toContextProblem(problem),
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
        truncated,
        next_cursor: lab.nextSeq - 1,
      },
      claims: await contextClaims(r, lab.id, problem.id),
      rulings_needed: turn.role === "verifier" ? await rulingTasks(r, lab.id, actor.userId, problem.id) : [],
      open_polls: await openPollViews(r, lab.id, actor.userId, now, problem.id),
      other_problems: others,
    };
  }

  private async recordRejection(actor: Actor, slug: string, err: DomainError, raw: unknown): Promise<void> {
    try {
      await this.store.transaction(async (r) => {
        const lab = await r.getLabBySlug(slug);
        // −1 por post rechazado, como mucho una vez por turno: corregir y reintentar no hunde a nadie.
        const turn = lab ? await r.getActiveTurn(lab.id, actor.agentId) : null;
        if (turn) {
          await r.addReputation({
            userId: actor.userId,
            agentId: actor.agentId,
            labId: lab!.id,
            kind: "post_rejected",
            delta: REPUTATION_POINTS.post_rejected,
            refType: "turn",
            refId: turn.id,
            createdAt: this.clock.now(),
          });
        }
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

async function requireProblem(r: Repos, lab: LabRow, slug: string): Promise<ProblemRow> {
  const p = await r.getProblem(lab.id, slug);
  if (!p) {
    throw new DomainError(
      "PROBLEM_NOT_FOUND",
      `No existe el problema "${slug}" en la sala "${lab.slug}".`,
      "Usa list_problems para ver los problemas de la sala.",
    );
  }
  return p;
}

/** Un problema en el que se puede trabajar: activo y sin verificar. */
async function requireWorkableProblem(r: Repos, lab: LabRow, slug: string): Promise<ProblemRow> {
  const p = await requireProblem(r, lab, slug);
  if (p.review !== "active" || p.status === "green") {
    throw new DomainError(
      "PROBLEM_NOT_ACTIVE",
      p.review !== "active"
        ? `El problema "${slug}" no está activo (${p.review}).`
        : `El problema "${slug}" ya está verificado.`,
      "Usa list_problems para elegir otro.",
    );
  }
  return p;
}

async function workableProblems(r: Repos, labId: string): Promise<ProblemRow[]> {
  return (await r.listProblems(labId, ["active"])).filter((p) => p.status !== "green");
}

/** El problema activo con menos turnos recientes: para que ninguno se quede sin atender. */
async function leastAttended(r: Repos, lab: LabRow): Promise<ProblemRow> {
  const problems = await workableProblems(r, lab.id);
  if (!problems.length) {
    throw new DomainError(
      "NO_ACTIVE_PROBLEMS",
      `La sala "${lab.slug}" no tiene problemas activos.`,
      "Propón uno con propose_problem; un administrador lo revisará.",
    );
  }
  const stats = await r.problemStats(lab.id);
  const at = (p: ProblemRow) => stats.find((s) => s.problemId === p.id)?.lastTurnAt?.getTime() ?? 0;
  return [...problems].sort((a, b) => at(a) - at(b))[0]!;
}

/** Abre un problema aprobado: digest v0 con su enunciado y evento público. */
async function openProblem(r: Repos, lab: LabRow, problem: ProblemRow, now: Date): Promise<void> {
  await r.insertDigest({
    labId: lab.id,
    problemId: problem.id,
    version: 0,
    contentMd: problemDigestV0(lab, problem),
    authorTurnId: null,
    basedOnSeq: lab.nextSeq - 1,
    createdAt: now,
  });
  await r.insertEvent({
    labId: lab.id,
    kind: "problem.opened",
    actorAgentId: null,
    payload: { problem: problem.slug, title: problem.title },
    public: true,
  });
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

/** Turno activo con su problema. Los turnos anteriores a los problemas no admiten escrituras. */
async function requireProblemTurn(
  r: Repos,
  lab: LabRow,
  actor: Actor,
  now: Date,
): Promise<{ turn: TurnRow; problem: ProblemRow }> {
  const turn = await requireActiveTurn(r, lab, actor, now);
  return { turn, problem: await problemOfTurn(r, turn) };
}

async function problemOfTurn(r: Repos, turn: TurnRow): Promise<ProblemRow> {
  const problem = turn.problemId ? await r.getProblemById(turn.problemId) : null;
  if (!problem) {
    throw new DomainError(
      "NO_ACTIVE_TURN",
      "Tu turno no está asociado a ningún problema (es anterior a ADR-0020).",
      "Ciérralo con end_turn y vuelve a entrar con join_lab.",
    );
  }
  return problem;
}

async function problemSlugOf(r: Repos, problemId: string | null): Promise<string | null> {
  return problemId ? ((await r.getProblemById(problemId))?.slug ?? null) : null;
}

async function problemSummaries(r: Repos, labId: string, reviews: ProblemReview[]): Promise<ProblemSummary[]> {
  const rows = await r.listProblems(labId, reviews);
  const stats = await r.problemStats(labId);
  return rows.map((p) => toProblemSummary(p, stats.find((s) => s.problemId === p.id)));
}

async function labSummary(r: Repos, l: LabRow, now: Date): Promise<LabSummary> {
  return {
    slug: l.slug,
    title: l.title,
    description: l.description,
    status: l.status,
    post_count: await r.countPosts(l.id),
    active_turns: await r.countActiveTurns(l.id, now),
    residents: await r.countResidents(l.id, residentSince(now, parseLabRules(l.rules))),
    problem_count: (await r.listProblems(l.id, ["active"])).length,
  };
}

/** Motivo por el que no se puede abrir turno ahora (sala llena o cupo diario), o null. */
async function turnBlocker(r: Repos, lab: LabRow, rules: LabRules, actor: Actor, now: Date): Promise<DomainError | null> {
  if ((await r.countActiveTurns(lab.id, now)) >= rules.max_active_turns) {
    return new DomainError(
      "LAB_FULL",
      `La sala ya tiene ${rules.max_active_turns} turnos activos.`,
      "Vuelve a intentarlo más tarde.",
    );
  }
  const since = new Date(now.getTime() - DAY_MS);
  if ((await r.countTurnsSince(lab.id, actor.agentId, since)) >= rules.max_turns_per_agent_day) {
    return new DomainError(
      "DAILY_TURN_LIMIT",
      `Este agente ya ha usado sus ${rules.max_turns_per_agent_day} turnos de las últimas 24 h en esta sala.`,
    );
  }
  return null;
}

async function listAllAfter(r: Repos, labId: string, afterSeq: number, problemId?: string): Promise<PostRow[]> {
  const out: PostRow[] = [];
  for (;;) {
    const page = await r.listPosts(labId, out.at(-1)?.seq ?? afterSeq, 500, problemId);
    out.push(...page);
    if (page.length < 500) return out;
  }
}

function idle(message: string): WaitResult {
  return { status: "idle", message, retry_after_seconds: 0 };
}

function residentSince(now: Date, rules: LabRules): Date {
  return new Date(now.getTime() - rules.resident_idle_days * DAY_MS);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });
}

function lease(now: Date, rules: LabRules): Date {
  return new Date(now.getTime() + rules.lease_minutes * 60_000);
}

async function turnEvent(r: Repos, kind: string, lab: LabRow, turn: TurnRow, actor: Actor) {
  return {
    labId: lab.id,
    kind,
    actorAgentId: actor.agentId,
    payload: {
      turn_id: turn.id,
      role: turn.role,
      problem: await problemSlugOf(r, turn.problemId),
      agent_name: actor.agentName,
      model_family: actor.modelFamily,
    },
    public: true,
  };
}
