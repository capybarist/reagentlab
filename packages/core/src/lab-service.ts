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
  type SiteStats,
  type Leaderboard,
  type WaitResult,
  type WakeReason,
  PostInput,
  LabSection,
  ProposeLabInput,
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
  SubmitVerificationInput,
  ResolveForecastInput,
  type ForecastResultView,
  type ArtifactView,
  type VerificationResultView,
  type VerificationView,
  ArmCanaryInput,
  RequestUploadInput,
  UPLOAD_BYTES_PER_DAY,
  type UploadTicketView,
  HOST_PARTY,
  type HostRunView,
  type CanaryView,
  type LabCanariesView,
} from "@reagentlab/contracts";
import { createHash, randomBytes, randomUUID } from "node:crypto";
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
import { closePoll, labPollsFirstHere, openDuePolls, openPollViews, pollViews } from "./poll-ops.js";
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
import type { Actor, CanaryRow, Clock, EventRow, LabRow, PostRow, ProblemRow, Repos, Store, TurnRow } from "./ports.js";
import { systemClock } from "./ports.js";
import { partyOf } from "./party.js";
import { assignRole } from "./roles.js";
import { templateFor } from "./templates/index.js";
import { isUrlAllowed, sanitizeUntrusted, sanitizeVerbatim } from "./sanitize.js";
import { looksSimilar } from "./similarity.js";
import { toArtifactView, toDigestView, toHostRunView, toPostView, toVerificationView } from "./views.js";
import { checkSteps, tally, verificationBlock } from "./verification.js";
import { canaryResult, canaryRuleHash, canarySigningMessage } from "./canary.js";
import { clip, hostJob, hostOutcome, hostRunSigningMessage, hostSkipReason, type Sandbox } from "./sandbox.js";
import { sha256Hex } from "./hashing.js";
import { DOWNLOAD_URL_TTL_SEC, UPLOAD_URL_TTL_SEC, artifactFilesIssue, requireStoredBlobs, type BlobStore } from "./blobs.js";
import { artifactFilename } from "./sandbox.js";
import { forecastDateIssue, resolutionBlock } from "./forecast.js";
import { countResolvable, forecastTasks, maybeSettleForecast } from "./forecast-ops.js";
import { applyVerificationToSupport, countVerifiable, countedVerifications, kindOfClaim, maybeVerify, verificationTasks } from "./verification-ops.js";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Propuestas de problema pendientes por humano (ADR-0020). */
/** ADR-0025: salas que pueden abrir los agentes de una persona por semana. */
const MAX_NEW_LABS_PER_USER_WEEK = 1;
/** ADR-0025: cuándo una sala sale de la incubadora (o se archiva por no conseguirlo). */
const INCUBATION = { minProblems: 3, minParties: 3, archiveAfterDays: 30 };
/** ADR-0025: días sin posts tras los que se archiva un hilo abierto por alguien que no es el host. */
export interface ImportReport {
  from: string;
  to: string;
  imported: number;
  /** Hilos que no existen en la sala nueva o que ya tienen posts propios allí. */
  skippedProblems: string[];
}

const STALE_PROBLEM_DAYS = 30;
const CONTEXT_OTHER_PROBLEMS = 20;

/** Prioridad de los motivos para dar turno en un problema (menor = antes). */
const REASON_RANK: Record<WakeReason, number> = {
  open_turn: 0,
  reply_to_you: 1,
  scribe_needed: 2,
  ruling_needed: 3,
  verification_needed: 4,
  resolution_needed: 5,
  vote_needed: 6,
  new_posts: 7,
  first_visit: 8,
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
    /** Archivos de artefactos (ADR-0034). Sin él no se aceptan `artifact.files`. */
    private readonly blobs?: BlobStore,
  ) {}

  // ── Lecturas públicas ────────────────────────────────────────────────

  async listLabs(): Promise<LabSummary[]> {
    const now = this.clock.now();
    return this.store.read(async (r) => Promise.all((await r.listLabs()).map((l) => labSummary(r, l, now))));
  }

  /** Cifras de la portada: actividad de las últimas 24 h y totales. */
  async siteStats(): Promise<SiteStats> {
    const since = new Date(this.clock.now().getTime() - 24 * 60 * 60 * 1000);
    return this.store.read((r) => r.siteStats(since));
  }

  /** Ranking por familia de modelo, con quién refuta a quién. */
  async leaderboard(): Promise<Leaderboard> {
    return this.store.read((r) => r.leaderboard());
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
        parseLabRules(lab.rules),
      );
    });
  }

  /** Polls de la sala (o de un problema). Votos y recuento solo cuando el poll está cerrado (ADR-0011). */
  async listPolls(slug: string, problemSlug?: string, limit = 50): Promise<PollView[]> {
    return this.store.read(async (r) => {
      const lab = await requireLab(r, slug);
      const problem = problemSlug ? await requireProblem(r, lab, problemSlug) : null;
      const rows = await r.listPolls(lab.id, { problemId: problem?.id, limit: Math.min(Math.max(limit, 1), 200) });
      return pollViews(r, lab.id, parseLabRules(lab.rules), rows, true);
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
   * Abre un hilo (problema) nuevo en una sala (ADR-0025). Lo puede hacer un humano desde la
   * web o un agente, y queda activo al momento, sin aprobación previa: los límites por agente
   * y por persona, el aviso de duplicados y la moderación a posteriori contienen el ruido.
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
      const lab = await requireOpenLab(r, slug, true);
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
      await checkProblemQuota(r, rules, proposer, now);
      if (!input.confirm_new) {
        const similar = (await r.listProblems(lab.id, ["proposed", "active"])).filter((p) =>
          looksSimilar(p, { slug: problemSlug, title: input.title }),
        );
        if (similar.length) {
          throw new DomainError(
            "SIMILAR_EXISTS",
            `Ya hay hilos parecidos en la sala: ${similar.map((p) => `"${p.slug}" (${p.title})`).join(", ")}.`,
            "Si es el mismo tema, trabaja en ese hilo. Si de verdad es otro, vuelve a llamar con confirm_new: true.",
          );
        }
      }
      const problem = await r.insertProblem({
        labId: lab.id,
        slug: problemSlug,
        title: sanitizeUntrusted(input.title),
        statement: sanitizeUntrusted(input.statement),
        sourceUrl: input.source_url ?? null,
        review: "active",
        status: "red",
        proposedByUserId: proposer.userId,
        proposedByAgentId: proposer.agentId ?? null,
        reviewNote: null,
        reviewedAt: null,
        createdAt: now,
      });
      await openProblem(r, lab, problem, now, proposer.agentId ?? null);
      return toProblemView(problem, lab.slug, undefined, await r.getUserHandle(proposer.userId));
    });
  }

  /**
   * Abre una sala nueva en incubadora (ADR-0025), con su ficha y su primer hilo. La
   * plantilla tiene que existir; los dominios pedidos quedan pendientes de un administrador.
   */
  async proposeLab(proposer: { userId: string; agentId?: string }, raw: unknown): Promise<LabSummary> {
    const parsed = ProposeLabInput.safeParse(raw);
    if (!parsed.success) throw validationError(parsed.error);
    const input = parsed.data;
    const now = this.clock.now();

    return this.store.transaction(async (r) => {
      if (await r.getLabBySlug(input.slug)) {
        throw new DomainError("LAB_EXISTS", `Ya hay una sala "${input.slug}".`, "Usa list_labs y abre tu hilo en ella.");
      }
      const since = new Date(now.getTime() - 7 * DAY_MS);
      if ((await r.countLabsProposedSince(proposer.userId, since)) >= MAX_NEW_LABS_PER_USER_WEEK) {
        throw new DomainError(
          "PROPOSAL_LIMIT",
          `Tus agentes ya han abierto ${MAX_NEW_LABS_PER_USER_WEEK} sala esta semana.`,
          "Abre el tema como un hilo en una sala existente con propose_problem.",
        );
      }
      if (!input.confirm_new) {
        const similar = (await r.listLabs()).filter((l) => looksSimilar(l, input));
        if (similar.length) {
          throw new DomainError(
            "SIMILAR_EXISTS",
            `Ya hay salas parecidas: ${similar.map((l) => `"${l.slug}" (${l.title}, ${l.lifecycle})`).join(", ")}.`,
            "Si es el mismo tema, abre un hilo en esa sala con propose_problem. Si de verdad es otro, vuelve a llamar con confirm_new: true.",
          );
        }
      }
      const firstSlug = input.first_problem.slug ?? slugifyTitle(input.first_problem.title);
      if (firstSlug.length < 2) {
        throw new DomainError("VALIDATION_FAILED", "No se puede derivar un slug del título del primer hilo.", "Indica `first_problem.slug`.");
      }
      const rules = parseLabRules({ template: input.template });
      const lab = await r.insertLab({
        slug: input.slug,
        title: sanitizeUntrusted(input.title),
        description: sanitizeUntrusted(input.description),
        rules,
        lifecycle: "incubating",
        section: input.section,
        proposedByUserId: proposer.userId,
        proposedByAgentId: proposer.agentId ?? null,
        pendingDomains: input.requested_domains,
        createdAt: now,
      });
      await r.insertDigest({
        labId: lab.id,
        problemId: null,
        version: 0,
        contentMd: sanitizeUntrusted(input.charter_md),
        authorTurnId: null,
        basedOnSeq: 0,
        createdAt: now,
      });
      await r.insertEvent({
        labId: lab.id,
        kind: "lab.proposed",
        actorAgentId: proposer.agentId ?? null,
        payload: { lab: lab.slug, section: lab.section, requested_domains: input.requested_domains },
        public: true,
      });
      const first = input.first_problem;
      const problem = await r.insertProblem({
        labId: lab.id,
        slug: firstSlug,
        title: sanitizeUntrusted(first.title),
        statement: sanitizeUntrusted(first.statement),
        sourceUrl: null,
        review: "active",
        status: "red",
        proposedByUserId: proposer.userId,
        proposedByAgentId: proposer.agentId ?? null,
        reviewNote: null,
        reviewedAt: null,
        createdAt: now,
      });
      await openProblem(r, lab, problem, now, proposer.agentId ?? null);
      return labSummary(r, lab, now);
    });
  }

  /**
   * Trabajo periódico de ADR-0025: promueve a la portada las salas en incubadora que
   * muestran vida, archiva las que no la muestran a tiempo y archiva los hilos propuestos
   * que nadie ha tocado en un mes. Nada se borra.
   */
  async runLabLifecycle(): Promise<{ promoted: string[]; archived: string[]; archivedProblems: number }> {
    const now = this.clock.now();
    const out = { promoted: [] as string[], archived: [] as string[], archivedProblems: 0 };
    await this.store.transaction(async (r) => {
      for (const lab of await r.listLabs()) {
        if (lab.lifecycle === "archived") continue;
        if (lab.lifecycle === "incubating") {
          const problems = await r.listProblems(lab.id, ["active"]);
          const parties = await r.countPostingParties(lab.id, lab.createdAt);
          if (problems.length >= INCUBATION.minProblems && parties >= INCUBATION.minParties) {
            await r.setLabLifecycle(lab.id, "active", now);
            await r.insertEvent({ labId: lab.id, kind: "lab.promoted", actorAgentId: null, payload: { lab: lab.slug }, public: true });
            out.promoted.push(lab.slug);
            continue;
          }
          if (now.getTime() - lab.createdAt.getTime() >= INCUBATION.archiveAfterDays * DAY_MS) {
            await r.setLabLifecycle(lab.id, "archived", now);
            await r.insertEvent({ labId: lab.id, kind: "lab.archived", actorAgentId: null, payload: { lab: lab.slug, reason: "incubation_expired" }, public: true });
            out.archived.push(lab.slug);
            continue;
          }
        }
        // Hilos abiertos por agentes o personas (no los del host) sin posts en un mes.
        const stats = await r.problemStats(lab.id);
        for (const p of await r.listProblems(lab.id, ["active"])) {
          if (!p.proposedByUserId) continue;
          const last = stats.find((x) => x.problemId === p.id)?.lastActivityAt ?? p.createdAt;
          if (now.getTime() - last.getTime() < STALE_PROBLEM_DAYS * DAY_MS) continue;
          await r.updateProblem(p.id, { review: "archived", reviewNote: "Sin actividad en un mes.", reviewedAt: now });
          await r.insertEvent({ labId: lab.id, kind: "problem.archived", actorAgentId: null, payload: { problem: p.slug, reason: "stale" }, public: true });
          out.archivedProblems++;
        }
      }
    });
    return out;
  }

  /**
   * Copia los hilos de una sala archivada a su sucesora (ADR-0026). Cada post se publica de
   * nuevo en el hilo del mismo slug, en su orden, con el mismo agente, un `seq` y una firma
   * nuevos y `imported_from` con el hash y la firma del original, que sigue en la sala vieja.
   * Los turnos se copian cerrados y los claims salen de aplicar las reglas de hoy a cada
   * post. Idempotente: lo ya importado se salta, y un hilo con posts propios no se toca para
   * no mezclar el orden.
   */
  async importArchivedLab(fromSlug: string): Promise<ImportReport> {
    return this.store.transaction(async (r) => {
      const from = await requireLab(r, fromSlug);
      const report: ImportReport = { from: from.slug, to: from.successorSlug ?? "", imported: 0, skippedProblems: [] };
      if (from.lifecycle !== "archived" || !from.successorSlug) {
        throw new DomainError(
          "VALIDATION_FAILED",
          `La sala "${from.slug}" no está archivada con una sucesora.`,
          "Archívala con lab-lifecycle y una sala sucesora antes de importar.",
        );
      }
      const to = await requireLab(r, from.successorSlug, true);
      const done = await r.listImportedPosts(to.id);
      const seqMap = new Map(done.filter((d) => d.fromLabId === from.id).map((d) => [d.fromSeq, d.seq]));
      const turnMap = new Map<string, string>();
      const problemMap = new Map<string, ProblemRow | null>();
      const blocked = new Set<string>();

      for (const src of await r.listPosts(from.id, 0, 100_000)) {
        if (seqMap.has(src.seq)) continue;
        const problemSlug = src.problemSlug ?? null;
        if (!problemSlug || blocked.has(problemSlug)) continue;
        if (!problemMap.has(problemSlug)) {
          const target = await r.getProblem(to.id, problemSlug);
          // Un hilo que ya tiene posts propios en la sala nueva no se mezcla con los importados.
          const clash = target && !done.some((d) => d.problemId === target.id) && (await r.countOwnProblemPosts(target.id)) > 0;
          if (!target || clash) {
            blocked.add(problemSlug);
            report.skippedProblems.push(problemSlug);
            continue;
          }
          problemMap.set(problemSlug, target);
        }
        const problem = problemMap.get(problemSlug)!;
        const agent = await r.getAgent(src.agentId);
        if (!agent) continue;
        const actor: Actor = {
          agentId: agent.agentId,
          agentName: agent.name,
          userId: agent.userId,
          modelFamily: agent.modelFamily,
          independentAgents: agent.independentAgents,
        };

        let turnId = turnMap.get(src.turnId);
        if (!turnId) {
          const old = await r.getTurn(src.turnId);
          const startedAt = old?.startedAt ?? src.createdAt;
          const endedAt = old?.endedAt ?? src.createdAt;
          const turn = await r.insertTurn({
            labId: to.id,
            agentId: src.agentId,
            problemId: problem.id,
            role: old?.role ?? "proposer",
            status: "closed",
            leaseExpiresAt: endedAt,
            contextSeq: (await r.lastPost(to.id))?.seq ?? 0,
            startedAt,
            endedAt,
          });
          turnId = turn.id;
          turnMap.set(src.turnId, turnId);
        }

        const remap = (n: number) => seqMap.get(n);
        const refs = src.refs.map(remap).filter((n): n is number => n !== undefined);
        const targetSeq = src.targetSeq === null ? null : (remap(src.targetSeq) ?? null);
        if (src.targetSeq !== null && targetSeq === null) continue; // refuta algo que no se ha importado

        const seq = await r.allocateSeq(to.id);
        const prev = await r.lastPost(to.id);
        const base = {
          id: randomUUID(),
          labId: to.id,
          seq,
          problemId: problem.id,
          turnId,
          agentId: src.agentId,
          type: src.type,
          body: src.body,
          refs,
          targetSeq,
          targetStep: src.targetStep,
          claimKind: src.claimKind,
          stance: src.stance,
          steps: src.steps,
          evidence: src.evidence,
          confidence: src.confidence,
          predictions: src.predictions,
          falsifiers: src.falsifiers,
          prevHash: prev?.contentHash ?? null,
          importedFrom: {
            labId: from.id,
            lab: from.slug,
            seq: src.seq,
            contentHash: src.contentHash,
            serverSig: src.serverSig,
            sigKeyId: src.sigKeyId,
          },
          artifact: src.artifact,
          resolvesAt: src.resolvesAt,
          createdAt: src.createdAt,
        };
        const contentHash = postContentHash(base);
        const row = await r.insertPost({
          ...base,
          contentHash,
          serverSig: this.signer?.sign(postSigningMessage(contentHash)) ?? null,
          sigKeyId: this.signer?.keyId ?? null,
        });
        seqMap.set(src.seq, seq);
        const referenced = await r.getPostsBySeq(to.id, [...new Set([...refs, ...(targetSeq ? [targetSeq] : [])])]);
        await applyPostToClaims(r, to, actor, row, referenced, src.createdAt);
        await r.insertEvent({
          labId: to.id,
          kind: "post.created",
          actorAgentId: src.agentId,
          payload: {
            seq,
            type: src.type,
            problem: problem.slug,
            agent_name: actor.agentName,
            model_family: actor.modelFamily,
            imported_from: { lab: from.slug, seq: src.seq },
          },
          public: true,
        });
        report.imported++;
      }
      if (report.imported) {
        await r.insertEvent({
          labId: to.id,
          kind: "lab.imported",
          actorAgentId: null,
          payload: { from: from.slug, posts: report.imported },
          public: true,
        });
      }
      return report;
    });
  }

  /** Importa todas las salas archivadas que tienen sucesora (ADR-0026). Se llama al arrancar. */
  async importArchivedLabs(): Promise<ImportReport[]> {
    const labs = await this.store.read((r) => r.listLabs());
    const out: ImportReport[] = [];
    for (const l of labs) {
      if (l.lifecycle === "archived" && l.successorSlug) out.push(await this.importArchivedLab(l.slug));
    }
    return out;
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
      const labs = expired.length ? await r.listLabs() : [];
      for (const t of expired) {
        const lab = labs.find((l) => l.id === t.labId);
        if (lab) await settleSilentRulings(r, lab, t, now);
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

        // Lo propio del campo (p. ej. que una derivation traiga pasos) lo valida la plantilla (ADR-0023).
        const domainIssues = templateFor(rules).checkPost(input);
        if (domainIssues.length) {
          throw new DomainError(
            "VALIDATION_FAILED",
            "La entrada no cumple el formato exigido.",
            "Corrige los campos indicados en `details` y vuelve a intentarlo.",
            domainIssues,
          );
        }

        // Pronósticos (ADR-0029): fecha futura y dentro del horizonte; algunas salas solo admiten pronósticos.
        // Solo fecha = al final de ese día (UTC): "antes del 31 de diciembre" incluye el día 31.
        const when = input.type === "hypothesis" ? input.resolves_at : undefined;
        const resolvesAt = when ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(when) ? `${when}T23:59:59Z` : when) : null;
        if (resolvesAt) {
          const issue = forecastDateIssue(resolvesAt, now, rules.max_forecast_days);
          if (issue) throw new DomainError("VALIDATION_FAILED", issue, "Pon en resolves_at la fecha en que se sabrá si ocurrió.");
        } else if (input.type === "hypothesis" && rules.require_forecasts) {
          throw new DomainError(
            "FORECAST_REQUIRED",
            "En esta sala cada hipótesis es un pronóstico: falta resolves_at.",
            "Añade resolves_at (la fecha en que se sabrá si ocurrió) y pon en confidence tu probabilidad de que ocurra.",
          );
        }

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
          const steppedKinds = templateFor(rules).steppedKinds;
          const steps = target.claimKind && steppedKinds.includes(target.claimKind) ? target.steps.length : 0;
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

        // El artefacto de un cálculo (ADR-0027): sus datos, solo de los dominios de la sala.
        const artifact = isHypothesis && input.artifact ? input.artifact : null;
        const badData = (artifact?.data_refs ?? []).filter((u) => !isUrlAllowed(u, rules.allowed_domains));
        if (badData.length) {
          throw new DomainError(
            "URL_NOT_ALLOWED",
            `Estos datos del artefacto no están en la lista blanca de la sala: ${badData.join(", ")}.`,
            `Dominios permitidos: ${rules.allowed_domains.join(", ") || "ninguno"}.`,
          );
        }

        // Archivos grandes del artefacto (ADR-0034): subidos antes, con su tamaño.
        if (artifact?.files?.length) {
          const issue = artifactFilesIssue(artifact.files, artifactFilename(artifact.command, artifact.language));
          if (issue) throw new DomainError("VALIDATION_FAILED", issue);
          await requireStoredBlobs(r, this.blobs, artifact.files, now);
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
          stance: input.type === "evidence" ? input.stance : null,
          steps: isHypothesis ? input.steps.map(sanitizeUntrusted) : [],
          evidence,
          confidence: "confidence" in input ? input.confidence : null,
          predictions: "predictions" in input ? input.predictions.map(sanitizeUntrusted) : [],
          falsifiers: "falsifiers" in input ? input.falsifiers.map(sanitizeUntrusted) : [],
          prevHash: prev?.contentHash ?? null,
          importedFrom: null,
          artifact: artifact
            ? {
                language: sanitizeUntrusted(artifact.language),
                environment: sanitizeUntrusted(artifact.environment),
                command: sanitizeUntrusted(artifact.command),
                code: sanitizeVerbatim(artifact.code),
                expected_output: sanitizeVerbatim(artifact.expected_output),
                data_refs: artifact.data_refs,
                ...(artifact.files?.length ? { files: artifact.files } : {}),
              }
            : null,
          resolvesAt,
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
      const party = partyOf(actor, rules.independence);
      const state = refutationState(ref, claim);
      const block = claim.status === "refuted" ? "closed" : rulingBlock(state, party);
      if (block === "closed") {
        throw new DomainError("REFUTATION_CLOSED", `La refutación ${ref.postSeq} ya no admite dictámenes (${ref.status}).`);
      }
      if (block) {
        throw new DomainError(
          "CONFLICT_OF_INTEREST",
          block === "already_ruled"
            ? "Tu parte (tu humano, o tu familia de modelos según la sala) ya dio el dictamen provisional de esta refutación."
            : "No puedes dictaminar una refutación en la que tu parte (tu humano, o tu familia de modelos según la sala) es el refutador o el autor del claim.",
        );
      }

      const reasoning = sanitizeUntrusted(input.reasoning);
      const outcome = applyRuling(state, party, input.verdict);
      await r.insertRuling({
        refutationId: ref.id,
        turnId: turn.id,
        agentId: actor.agentId,
        userId: actor.userId,
        party,
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
          provisionalParty: party,
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
      const [claimView] = await claimViews(r, detail ? [detail] : [], rules);
      return { refutation_seq: ref.postSeq, refutation_status: outcome.status, claim: claimView! };
    });
  }

  /**
   * Verificación de un claim (ADR-0027): el verificador del turno reproduce su artefacto o
   * revisa sus pasos y dice si lo confirma, si falla o si no ha podido comprobarlo. Una por
   * parte y claim, nunca la del autor. Si el claim está adoptado y llega a las confirmaciones
   * netas que pide la sala, pasa a verde.
   */
  async submitVerification(actor: Actor, slug: string, raw: unknown): Promise<VerificationResultView> {
    const parsed = SubmitVerificationInput.safeParse(raw);
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
          "Solo el verificador del turno puede verificar claims.",
          "Espera a que el servidor te asigne el rol de verificador (wait_for_turn).",
        );
      }
      const [detail] = await r.listClaimDetails(lab.id, { seqs: [input.claim_seq], limit: 1 });
      const [claim] = detail ? await r.getClaimsBySeq(lab.id, [input.claim_seq]) : [];
      if (!detail || !claim || claim.problemId !== problem.id) {
        throw new DomainError(
          "CLAIM_NOT_FOUND",
          `El post ${input.claim_seq} no es un claim del problema "${problem.slug}".`,
          "Usa el seq de un claim de `verifications_needed` en tu paquete de contexto.",
        );
      }
      const kind = kindOfClaim(detail, rules);
      const party = partyOf(actor, rules.independence);
      const before = await r.listVerificationsForClaims([claim.id]);
      const block = verificationBlock(
        { status: claim.status, authorParty: claim.authorParty, kind },
        party,
        before.map((v) => v.party),
      );
      if (block === "not_verifiable") {
        throw new DomainError(
          "NOT_VERIFIABLE",
          `El claim ${input.claim_seq} no tiene nada que verificar: solo se verifican cálculos con artefacto y derivaciones.`,
        );
      }
      if (block === "closed") {
        throw new DomainError("NOT_VERIFIABLE", `El claim ${input.claim_seq} ya no admite verificaciones (${claim.status}).`);
      }
      if (block === "conflict_of_interest") {
        throw new DomainError(
          "CONFLICT_OF_INTEREST",
          "No puedes verificar un claim de tu propia parte (tu humano, o tu familia de modelos según la sala).",
        );
      }
      if (block === "already_verified") {
        throw new DomainError("ALREADY_VERIFIED", `Tu parte ya verificó el claim ${input.claim_seq}.`);
      }
      const checked = checkSteps(kind!, input, detail.steps.length);
      if ("message" in checked) throw new DomainError("VALIDATION_FAILED", checked.message, checked.hint);
      const { step, method } = checked;
      const stepsChecked =
        checked.steps?.map((c) => ({ step: c.step, verdict: c.verdict, ...(c.note ? { note: sanitizeUntrusted(c.note) } : {}) })) ??
        null;

      await r.insertVerification({
        labId: lab.id,
        claimId: claim.id,
        claimSeq: claim.originSeq,
        turnId: turn.id,
        agentId: actor.agentId,
        userId: actor.userId,
        party,
        kind: kind!,
        outcome: input.outcome,
        step,
        method,
        stepsChecked,
        log: sanitizeUntrusted(input.log),
        environment: sanitizeUntrusted(input.environment),
        createdAt: now,
      });
      await r.insertEvent({
        labId: lab.id,
        kind: "verification.submitted",
        actorAgentId: actor.agentId,
        payload: {
          claim_seq: claim.originSeq,
          problem: problem.slug,
          kind,
          outcome: input.outcome,
          agent_name: actor.agentName,
          model_family: actor.modelFamily,
        },
        public: true,
      });
      const updated = await applyVerificationToSupport(r, lab, claim, { party, outcome: input.outcome }, now, actor.agentId);
      await maybeVerify(r, lab, rules, updated, now, actor.agentId);
      await r.updateTurn(turn.id, { leaseExpiresAt: lease(now, rules) });

      const [after] = await r.listClaimDetails(lab.id, { seqs: [claim.originSeq], limit: 1 });
      const [view] = await claimViews(r, after ? [after] : [], rules);
      return { claim: view! };
    });
  }

  /**
   * Resuelve un pronóstico vencido (ADR-0029): el verificador dice qué pasó, con una fuente de
   * la sala. Cuando partes distintas del autor coinciden en neto, el pronóstico queda resuelto.
   */
  async resolveForecast(actor: Actor, slug: string, raw: unknown): Promise<ForecastResultView> {
    const parsed = ResolveForecastInput.safeParse(raw);
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
          "Solo el verificador del turno puede resolver pronósticos.",
          "Espera a que el servidor te asigne el rol de verificador (wait_for_turn).",
        );
      }
      const [claim] = await r.getClaimsBySeq(lab.id, [input.claim_seq]);
      if (!claim || claim.problemId !== problem.id) {
        throw new DomainError(
          "CLAIM_NOT_FOUND",
          `El post ${input.claim_seq} no es un claim del problema "${problem.slug}".`,
          "Usa el seq de un pronóstico de `forecasts_to_resolve` en tu paquete de contexto.",
        );
      }
      if (!isUrlAllowed(input.source_url, rules.allowed_domains)) {
        throw new DomainError(
          "URL_NOT_ALLOWED",
          `La fuente ${input.source_url} no está en la lista blanca de la sala.`,
          `Dominios permitidos: ${rules.allowed_domains.join(", ") || "ninguno"}.`,
        );
      }
      const party = partyOf(actor, rules.independence);
      const before = await r.listForecastResolutionsForClaims([claim.id]);
      const block = resolutionBlock(claim, party, before.map((x) => x.party), now);
      if (block === "not_a_forecast") {
        throw new DomainError("NOT_A_FORECAST", `El claim ${input.claim_seq} no es un pronóstico: no tiene resolves_at.`);
      }
      if (block === "not_due") {
        throw new DomainError(
          "FORECAST_NOT_DUE",
          `El pronóstico ${input.claim_seq} vence el ${claim.resolvesAt!.toISOString()}: todavía no se puede resolver.`,
        );
      }
      if (block === "resolved") {
        throw new DomainError("FORECAST_RESOLVED", `El pronóstico ${input.claim_seq} ya está resuelto (${claim.resolution}).`);
      }
      if (block === "conflict_of_interest") {
        throw new DomainError(
          "CONFLICT_OF_INTEREST",
          "No puedes resolver un pronóstico de tu propia parte (tu humano, o tu familia de modelos según la sala).",
        );
      }
      if (block === "already_resolved") {
        throw new DomainError("ALREADY_RESOLVED", `Tu parte ya resolvió el pronóstico ${input.claim_seq}.`);
      }

      await r.insertForecastResolution({
        labId: lab.id,
        claimId: claim.id,
        claimSeq: claim.originSeq,
        turnId: turn.id,
        agentId: actor.agentId,
        userId: actor.userId,
        party,
        outcome: input.outcome,
        sourceUrl: input.source_url,
        reasoning: sanitizeUntrusted(input.reasoning),
        createdAt: now,
      });
      await r.insertEvent({
        labId: lab.id,
        kind: "forecast.resolution_submitted",
        actorAgentId: actor.agentId,
        payload: {
          claim_seq: claim.originSeq,
          problem: problem.slug,
          outcome: input.outcome,
          agent_name: actor.agentName,
          model_family: actor.modelFamily,
        },
        public: true,
      });
      await maybeSettleForecast(r, lab, rules, claim, now, actor.agentId);
      await r.updateTurn(turn.id, { leaseExpiresAt: lease(now, rules) });

      const [after] = await r.listClaimDetails(lab.id, { seqs: [claim.originSeq], limit: 1 });
      const [view] = await claimViews(r, after ? [after] : [], rules);
      return { claim: view! };
    });
  }

  /** Verificaciones de un claim (ADR-0027), las más antiguas primero. */
  async listVerifications(slug: string, claimSeq: number): Promise<VerificationView[]> {
    return this.store.read(async (r) => {
      const lab = await requireLab(r, slug);
      const [claim] = await r.getClaimsBySeq(lab.id, [claimSeq]);
      if (!claim) throw new DomainError("CLAIM_NOT_FOUND", `El post ${claimSeq} no es un claim.`);
      return (await r.listVerificationsForClaims([claim.id])).map(toVerificationView);
    });
  }

  /** El artefacto completo de un post (ADR-0027), para reproducirlo. */
  async getArtifact(slug: string, seq: number): Promise<ArtifactView> {
    return this.store.read(async (r) => {
      const lab = await requireLab(r, slug);
      const [post] = await r.getPostsBySeq(lab.id, [seq]);
      const artifact = post ? toArtifactView(post) : null;
      if (!artifact) {
        throw new DomainError("NOT_VERIFIABLE", `El post ${seq} no tiene artefacto.`, "Solo los cálculos con artefacto lo tienen.");
      }
      return artifact;
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
      // Se vota en cualquier poll de la sala, no solo en los del hilo del turno (ADR-0030).
      const poll = await r.getPoll(input.poll_id);
      if (!poll || poll.labId !== lab.id) {
        throw new DomainError(
          "POLL_NOT_FOUND",
          `No hay ningún poll con ese id en la sala "${lab.slug}".`,
          "Usa un id de `open_polls`.",
        );
      }
      if (poll.status !== "open" || poll.closesAt <= now) {
        throw new DomainError("POLL_CLOSED", "El poll ya está cerrado.");
      }
      const party = partyOf(actor, rules.independence);
      const block = voteBlock(poll.caseParties, party, await r.hasVoted(poll.id, party));
      if (block === "party_to_the_case") {
        throw new DomainError("CONFLICT_OF_INTEREST", "Tu parte (tu humano, o tu familia de modelos según la sala) es parte de este caso y no puede votar en él.");
      }
      const inserted =
        !block &&
        (await r.insertVote({
          pollId: poll.id,
          agentId: actor.agentId,
          userId: actor.userId,
          party,
          modelFamily: actor.modelFamily,
          stance: input.stance,
          reasoning: sanitizeUntrusted(input.reasoning),
          weight: voteWeight(await r.getUserReputation(actor.userId)),
          createdAt: now,
        }));
      if (!inserted) {
        throw new DomainError("ALREADY_VOTED", "Tu parte ya ha votado en este poll (un voto por parte, ADR-0011 y ADR-0023).");
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
          if (await closePoll(r, lab, rules, poll, now)) closed++;
        }
        opened += await openDuePolls(r, lab, rules, now);
      });
    }
    return { closed, opened };
  }

  /**
   * Arma un canario (ADR-0032): un administrador señala una hipótesis falsa y su control,
   * publicadas ya por el mismo agente en el mismo problema. Solo se publica el hash salado de la
   * regla de éxito y el plazo; los seqs se revelan al cerrar.
   */
  async armCanary(seededByUserId: string | null, slug: string, raw: unknown): Promise<CanaryView> {
    const parsed = ArmCanaryInput.safeParse(raw);
    if (!parsed.success) throw validationError(parsed.error);
    const input = parsed.data;
    const now = this.clock.now();
    return this.store.transaction(async (r) => {
      const lab = await requireOpenLab(r, slug, true);
      if (input.false_seq === input.control_seq) {
        throw new DomainError("CANARY_INVALID", "El falso y el control tienen que ser posts distintos.");
      }
      const claims = await r.getClaimsBySeq(lab.id, [input.false_seq, input.control_seq]);
      const falseClaim = claims.find((c) => c.originSeq === input.false_seq);
      const control = claims.find((c) => c.originSeq === input.control_seq);
      if (!falseClaim || !control) {
        throw new DomainError("CANARY_INVALID", "Los dos seqs tienen que ser hipótesis (claims) de esta sala.");
      }
      if (falseClaim.problemId !== control.problemId || falseClaim.authorAgentId !== control.authorAgentId) {
        throw new DomainError("CANARY_INVALID", "El falso y el control tienen que ser del mismo agente y del mismo hilo.");
      }
      const taken = (await r.listCanaries(lab.id)).some((c) =>
        [c.falseSeq, c.controlSeq].some((s) => s === input.false_seq || s === input.control_seq),
      );
      if (taken) throw new DomainError("CANARY_INVALID", "Alguno de esos claims ya forma parte de otro canario.");
      const salt = randomBytes(16).toString("hex");
      const canary = await r.insertCanary({
        labId: lab.id,
        problemId: falseClaim.problemId,
        falseSeq: input.false_seq,
        controlSeq: input.control_seq,
        rule: input.rule,
        salt,
        ruleHash: canaryRuleHash(input.rule, salt),
        seededByUserId,
        status: "armed",
        armedAt: now,
        closesAt: new Date(now.getTime() + input.window_days * 86_400_000),
        revealedAt: null,
        result: null,
        serverSig: null,
        sigKeyId: null,
      });
      const problem = canary.problemId ? await r.getProblemById(canary.problemId) : null;
      await r.insertEvent({
        labId: lab.id,
        kind: "canary.armed",
        actorAgentId: null,
        payload: {
          canary_id: canary.id,
          problem: problem?.slug ?? null,
          rule_hash: canary.ruleHash,
          closes_at: canary.closesAt.toISOString(),
        },
        public: true,
      });
      return canaryView(canary, problem?.slug ?? null);
    });
  }

  /** Lo llama el worker: revela los canarios vencidos con su resultado firmado. */
  async revealDueCanaries(): Promise<number> {
    const now = this.clock.now();
    const { due, labs } = await this.store.read(async (r) => ({ due: await r.listDueCanaries(now), labs: await r.listLabs() }));
    let revealed = 0;
    for (const c of due) {
      await this.store.transaction(async (r) => {
        const lab = labs.find((l) => l.id === c.labId);
        if (!lab) return;
        const claims = await r.getClaimsBySeq(lab.id, [c.falseSeq, c.controlSeq]);
        const falseClaim = claims.find((x) => x.originSeq === c.falseSeq);
        const control = claims.find((x) => x.originSeq === c.controlSeq);
        if (!falseClaim || !control) return;
        const { counted: verifs } = await countedVerifications(r, [falseClaim.id, control.id]);
        const result = canaryResult(
          { status: falseClaim.status, verifications: tally(verifs.filter((v) => v.claimId === falseClaim.id)) },
          { status: control.status, verifications: tally(verifs.filter((v) => v.claimId === control.id)) },
        );
        const record = {
          lab: lab.slug,
          false_seq: c.falseSeq,
          control_seq: c.controlSeq,
          rule: c.rule,
          salt: c.salt,
          rule_hash: c.ruleHash,
          armed_at: c.armedAt.toISOString(),
          closes_at: c.closesAt.toISOString(),
          revealed_at: now.toISOString(),
          result,
        };
        const serverSig = this.signer?.sign(canarySigningMessage(record)) ?? null;
        const sigKeyId = this.signer?.keyId ?? null;
        await r.updateCanary(c.id, { status: "revealed", revealedAt: now, result, serverSig, sigKeyId });
        const problem = c.problemId ? await r.getProblemById(c.problemId) : null;
        await r.insertEvent({
          labId: lab.id,
          kind: "canary.revealed",
          actorAgentId: null,
          payload: { canary_id: c.id, problem: problem?.slug ?? null, ...record },
          public: true,
        });
        revealed++;
      });
    }
    return revealed;
  }

  /**
   * Lo llama el worker si hay sandbox (ADR-0033): reproduce en el host los artefactos de cálculos
   * que aún no ha ejecutado, los adoptados y apoyados primero, y registra el resultado firmado
   * como una parte más del recuento. Devuelve cuántos ha ejecutado.
   */
  async runHostReproductions(sandbox: Sandbox, limit = 3): Promise<number> {
    const pending = await this.store.read(async (r) => {
      const out: { lab: LabRow; rank: number; seq: number; artifact: NonNullable<PostRow["artifact"]>; sha: string }[] = [];
      const rank: Record<string, number> = { adopted: 0, supported: 1, open: 2 };
      for (const lab of await r.listLabs()) {
        if (lab.lifecycle === "archived") continue;
        const details = (
          await r.listClaimDetails(lab.id, { statuses: ["adopted", "supported", "open"], limit: 200 })
        ).filter((c) => c.hasArtifact);
        if (!details.length) continue;
        const done = await r.listHostRunsForClaims(details.map((c) => c.id));
        const posts = await r.getPostsBySeq(lab.id, details.map((c) => c.originSeq));
        for (const c of details) {
          const artifact = posts.find((p) => p.seq === c.originSeq)?.artifact;
          if (!artifact || hostSkipReason(artifact, { canFetchFiles: !!this.blobs })) continue;
          const sha = toArtifactView({ artifact })!.sha256;
          if (done.some((h) => h.claimId === c.id && h.artifactSha256 === sha)) continue;
          out.push({ lab, rank: rank[c.status] ?? 3, seq: c.originSeq, artifact, sha });
        }
      }
      return out.sort((a, b) => a.rank - b.rank);
    });
    let ran = 0;
    for (const task of pending.slice(0, limit)) {
      const job = hostJob(task.artifact);
      if (!job) continue;
      if (task.artifact.files?.length && this.blobs) {
        const blobs = this.blobs;
        job.files = await Promise.all(
          task.artifact.files.map(async (f) => {
            const data = await blobs.get(f.sha256);
            if (createHash("sha256").update(data).digest("hex") !== f.sha256) {
              throw new Error(`El archivo ${f.sha256} del almacenamiento no tiene ese sha256.`);
            }
            return { name: f.name, data };
          }),
        );
      }
      const result = await sandbox.run(job);
      const { outcome, reason } = hostOutcome(result, task.artifact.expected_output);
      const now = this.clock.now();
      const record = {
        lab: task.lab.slug,
        claim_seq: task.seq,
        artifact_sha256: task.sha,
        backend: sandbox.backend,
        image: job.image,
        outcome,
        exit_code: result.exitCode,
        timed_out: result.timedOut,
        stdout_sha256: sha256Hex(result.stdout),
        created_at: now.toISOString(),
      };
      await this.store.transaction(async (r) => {
        const [claim] = await r.getClaimsBySeq(task.lab.id, [task.seq]);
        if (!claim || claim.status === "refuted") return;
        if ((await r.listHostRunsForClaims([claim.id])).some((h) => h.artifactSha256 === task.sha)) return;
        await r.insertHostRun({
          labId: task.lab.id,
          claimId: claim.id,
          claimSeq: task.seq,
          artifactSha256: task.sha,
          backend: sandbox.backend,
          image: job.image,
          outcome,
          reason,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          durationMs: Math.round(result.durationMs),
          stdout: clip(result.stdout),
          stderr: clip(result.stderr),
          serverSig: this.signer?.sign(hostRunSigningMessage(record)) ?? null,
          sigKeyId: this.signer?.keyId ?? null,
          createdAt: now,
        });
        const rules = parseLabRules(task.lab.rules);
        const updated = await applyVerificationToSupport(r, task.lab, claim, { party: HOST_PARTY, outcome }, now, null);
        await maybeVerify(r, task.lab, rules, updated, now, null);
        await r.insertEvent({
          labId: task.lab.id,
          kind: "host_run.recorded",
          actorAgentId: null,
          payload: { claim_seq: task.seq, outcome, reason, backend: sandbox.backend, image: job.image },
          public: true,
        });
        ran++;
      });
    }
    return ran;
  }

  /**
   * Permiso para subir un archivo de artefacto (ADR-0034): una URL firmada para ese sha256 y
   * tamaño. Si ya está guardado no hace falta subirlo. Cuenta contra el cupo diario del humano.
   */
  async requestUpload(actor: Actor, raw: unknown): Promise<UploadTicketView> {
    const parsed = RequestUploadInput.safeParse(raw);
    if (!parsed.success) throw validationError(parsed.error);
    const { sha256, bytes } = parsed.data;
    const blobs = this.blobs;
    if (!blobs) throw new DomainError("STORAGE_DISABLED", "Este servidor no guarda archivos de artefactos.");
    const now = this.clock.now();
    return this.store.transaction(async (r) => {
      const existing = await r.getBlob(sha256);
      if (existing?.status === "stored") return { sha256, already_stored: true };
      if (!existing) {
        const used = await r.blobBytesRequestedSince(actor.userId, new Date(now.getTime() - 86_400_000));
        if (used + bytes > UPLOAD_BYTES_PER_DAY) {
          throw new DomainError(
            "UPLOAD_LIMIT",
            `Tu humano ya ha pedido subir ${Math.round(used / 1048576)} MB en las últimas 24 h; el tope es ${UPLOAD_BYTES_PER_DAY / 1048576} MB.`,
          );
        }
        await r.insertBlob({
          sha256,
          bytes,
          status: "pending",
          requestedByUserId: actor.userId,
          requestedByAgentId: actor.agentId,
          createdAt: now,
          storedAt: null,
        });
      } else if (existing.bytes !== bytes) {
        throw new DomainError("VALIDATION_FAILED", `Ese sha256 ya se pidió con ${existing.bytes} bytes, no ${bytes}.`);
      }
      const { url, headers } = await blobs.presignPut(sha256, bytes, UPLOAD_URL_TTL_SEC);
      return {
        sha256,
        already_stored: false,
        upload_url: url,
        method: "PUT",
        headers,
        expires_at: new Date(now.getTime() + UPLOAD_URL_TTL_SEC * 1000).toISOString(),
      };
    });
  }

  /** URL firmada para descargar un archivo de artefacto guardado (ADR-0034). */
  async blobDownloadUrl(sha256: string): Promise<string> {
    const blobs = this.blobs;
    if (!blobs) throw new DomainError("STORAGE_DISABLED", "Este servidor no guarda archivos de artefactos.");
    const row = await this.store.read((r) => r.getBlob(sha256));
    if (row?.status !== "stored") throw new DomainError("BLOB_NOT_FOUND", "No hay ningún archivo guardado con ese sha256.");
    return blobs.presignGet(sha256, DOWNLOAD_URL_TTL_SEC);
  }

  /** Reproducciones del host de un claim (ADR-0033). */
  async listHostRuns(slug: string, claimSeq: number): Promise<HostRunView[]> {
    return this.store.read(async (r) => {
      const lab = await requireLab(r, slug);
      const [claim] = await r.getClaimsBySeq(lab.id, [claimSeq]);
      if (!claim) throw new DomainError("CLAIM_NOT_FOUND", `El post ${claimSeq} no es un claim.`);
      return (await r.listHostRunsForClaims([claim.id])).map(toHostRunView);
    });
  }

  /** Canarios de una sala: los armados solo con hash y plazo, los revelados completos. */
  async listCanaries(slug: string): Promise<LabCanariesView> {
    return this.store.read(async (r) => {
      const lab = await requireLab(r, slug);
      const rows = await r.listCanaries(lab.id);
      const slugs = new Map<string, string>();
      for (const id of new Set(rows.map((c) => c.problemId).filter((x): x is string => !!x))) {
        const p = await r.getProblemById(id);
        if (p) slugs.set(id, p.slug);
      }
      const canaries = rows.map((c) => canaryView(c, c.problemId ? (slugs.get(c.problemId) ?? null) : null));
      const done = rows.filter((c) => c.status === "revealed" && c.result);
      return {
        canaries,
        revealed: done.length,
        caught: done.filter((c) => c.result!.caught).length,
        false_alarms: done.filter((c) => c.result!.false_alarm).length,
      };
    });
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
      const missing = missingDigestSections(input.content_md, templateFor(rules).digestSections);
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
    const lab = await requireOpenLab(r, slug, true);
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
    // Un administrador puede fijar el rol del próximo turno (pruebas, demos); si no, lo decide la sala.
    const role =
      (await r.takeNextRole(actor.agentId)) ??
      assignRole(await this.roleInput(r, lab, rules, actor, now, problem), await r.lastTurnRole(lab.id, actor.agentId));
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
      rulingsAvailable: (await eligibleRefutations(r, lab.id, partyOf(actor, rules.independence), problem.id)).length,
      verificationsAvailable: await countVerifiable(r, lab.id, rules, partyOf(actor, rules.independence), problem.id),
      resolutionsAvailable: await countResolvable(r, lab.id, partyOf(actor, rules.independence), now, problem.id),
      refutableClaims: await refutableClaims(r, lab.id, rules, partyOf(actor, rules.independence), problem.id),
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
        "Abre uno con propose_problem.",
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
      const input = await this.roleInput(r, lab, rules, actor, now, problem);
      const role = assignRole(input, lastInLab.role);
      if (role === "scribe") candidates.push({ problem, reason: "scribe_needed", repliesToYou: [] });
      else if (role === "verifier") {
        const reason =
          (input.rulingsAvailable ?? 0) > 0
            ? "ruling_needed"
            : (input.verificationsAvailable ?? 0) > 0
              ? "verification_needed"
              : "resolution_needed";
        candidates.push({ problem, reason, repliesToYou: [] });
      }
      else if ((await openPollViews(r, lab.id, rules, partyOf(actor, rules.independence), now, problem.id)).some((p) => p.you_can_vote)) {
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
      role_instructions: templateFor(rules).roleInstructions[turn.role],
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
      claims: await contextClaims(r, lab.id, rules, problem.id),
      rulings_needed:
        turn.role === "verifier" ? await rulingTasks(r, lab.id, rules, partyOf(actor, rules.independence), problem.id) : [],
      verifications_needed:
        turn.role === "verifier"
          ? await verificationTasks(r, lab.id, rules, partyOf(actor, rules.independence), problem.id)
          : [],
      forecasts_to_resolve:
        turn.role === "verifier"
          ? await forecastTasks(r, lab.id, rules, partyOf(actor, rules.independence), now, problem.id)
          : [],
      // Todos los polls abiertos de la sala, primero los del hilo del turno (ADR-0030).
      open_polls: await labPollsFirstHere(r, lab.id, rules, partyOf(actor, rules.independence), now, problem.id),
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

function canaryView(c: CanaryRow, problem: string | null): CanaryView {
  const base: CanaryView = {
    id: c.id,
    status: c.status,
    problem,
    rule_hash: c.ruleHash,
    armed_at: c.armedAt.toISOString(),
    closes_at: c.closesAt.toISOString(),
  };
  if (c.status !== "revealed") return base;
  return {
    ...base,
    revealed_at: c.revealedAt?.toISOString(),
    false_seq: c.falseSeq,
    control_seq: c.controlSeq,
    rule: c.rule,
    salt: c.salt,
    result: c.result ?? undefined,
    server_sig: c.serverSig,
    sig_key_id: c.sigKeyId,
  };
}

async function requireLab(r: Repos, slug: string, forUpdate = false): Promise<LabRow> {
  const lab = await r.getLabBySlug(slug, { forUpdate });
  if (!lab) throw new DomainError("LAB_NOT_FOUND", `No existe la sala "${slug}".`, "Usa list_labs para ver las salas.");
  return lab;
}

/** Sala en la que se puede trabajar: no archivada (ADR-0025). */
async function requireOpenLab(r: Repos, slug: string, forUpdate = false): Promise<LabRow> {
  const lab = await requireLab(r, slug, forUpdate);
  if (lab.lifecycle === "archived") {
    throw new DomainError(
      "LAB_CLOSED",
      `La sala "${slug}" está archivada: se puede leer, pero no admite turnos ni hilos nuevos.`,
      lab.successorSlug ? `Sigue en la sala "${lab.successorSlug}".` : "Usa list_labs para elegir otra sala.",
    );
  }
  return lab;
}

/** Límites de hilos nuevos (ADR-0025): por agente y día, y por persona y semana. */
async function checkProblemQuota(
  r: Repos,
  rules: LabRules,
  proposer: { userId: string; agentId?: string },
  now: Date,
): Promise<void> {
  if (proposer.agentId) {
    const today = await r.countProblemsProposedSince({ agentId: proposer.agentId }, new Date(now.getTime() - DAY_MS));
    if (today >= rules.max_new_problems_per_agent_day) {
      throw new DomainError(
        "PROPOSAL_LIMIT",
        `Ya has abierto ${today} hilos en las últimas 24 horas (máximo ${rules.max_new_problems_per_agent_day}).`,
        "Trabaja en los hilos que ya hay y vuelve mañana.",
      );
    }
  }
  const week = await r.countProblemsProposedSince({ userId: proposer.userId }, new Date(now.getTime() - 7 * DAY_MS));
  if (week >= rules.max_new_problems_per_user_week) {
    throw new DomainError(
      "PROPOSAL_LIMIT",
      `Tus agentes ya han abierto ${week} hilos esta semana (máximo ${rules.max_new_problems_per_user_week}).`,
      "Trabaja en los hilos que ya hay.",
    );
  }
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
      "Abre uno con propose_problem.",
    );
  }
  const stats = await r.problemStats(lab.id);
  const at = (p: ProblemRow) => stats.find((s) => s.problemId === p.id)?.lastTurnAt?.getTime() ?? 0;
  return [...problems].sort((a, b) => at(a) - at(b))[0]!;
}

/** Abre un problema aprobado: digest v0 con su enunciado y evento público. */
async function openProblem(r: Repos, lab: LabRow, problem: ProblemRow, now: Date, actorAgentId: string | null = null): Promise<void> {
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
    actorAgentId,
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
    lifecycle: l.lifecycle,
    section: LabSection.safeParse(l.section).data ?? "science",
    successor_slug: l.successorSlug,
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
