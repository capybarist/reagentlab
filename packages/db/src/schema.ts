import type { StepCheck } from "@reagentlab/contracts";
import { sql } from "drizzle-orm";
import {
  bigserial,
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

// Esquema (ARCHITECTURE §4). Artefactos y verificaciones llegan en la Fase 2.

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    providerId: text("provider_id").notNull(),
    handle: text("handle").notNull(),
    accountCreatedAt: ts("account_created_at"),
    reputation: integer("reputation").notNull().default(0),
    bannedAt: ts("banned_at"),
    /** Cada agente suyo cuenta como parte independiente (ADR-0024). Solo lo activa un admin. */
    independentAgents: boolean("independent_agents").notNull().default(false),
    /** Tope de agentes activos propio, en lugar del de las reglas de cuenta. Solo lo pone un admin. */
    maxAgents: integer("max_agents"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_provider_uq").on(t.provider, t.providerId)],
);

/**
 * Login con email y contraseña (ADR-0022). Un usuario `provider = "email"` tiene una fila
 * aquí; la contraseña va con scrypt y sal propia, nunca en claro.
 */
export const emailCredentials = pgTable("email_credentials", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/**
 * Códigos de 6 cifras enviados por email: alta (`signup`, con la contraseña y el handle
 * pendientes) y cambio de contraseña (`reset`). Se guardan como hash; caducan y tienen
 * un tope de intentos.
 */
export const emailCodes = pgTable(
  "email_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    purpose: text("purpose", { enum: ["signup", "reset"] }).notNull(),
    codeHash: text("code_hash").notNull(),
    pendingPasswordHash: text("pending_password_hash"),
    pendingHandle: text("pending_handle"),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: ts("expires_at").notNull(),
    consumedAt: ts("consumed_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("email_codes_email_idx").on(t.email, t.purpose)],
);

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    name: text("name").notNull(),
    modelFamily: text("model_family").notNull(),
    status: text("status", { enum: ["active", "disabled", "banned"] }).notNull().default("active"),
    /** Rol que un administrador ha fijado para su próximo turno; se consume al abrirlo. */
    nextRole: text("next_role", { enum: ["proposer", "refuter", "verifier", "scribe"] }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("agents_user_name_uq").on(t.userId, t.name)],
);

/** Claves públicas de firma de los agentes (ADR-0036). Una vigente por agente; las revocadas se quedan. */
export const agentKeys = pgTable(
  "agent_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id").notNull().references(() => agents.id),
    keyId: text("key_id").notNull(),
    publicKey: text("public_key").notNull(),
    createdAt: ts("created_at").notNull(),
    revokedAt: ts("revoked_at"),
  },
  (t) => [
    uniqueIndex("agent_keys_agent_key_uq").on(t.agentId, t.keyId),
    uniqueIndex("agent_keys_one_active_uq").on(t.agentId).where(sql`${t.revokedAt} IS NULL`),
  ],
);

/** Impugnaciones de digests (ADR-0037). */
export const digestChallenges = pgTable(
  "digest_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    labId: uuid("lab_id").notNull().references(() => labs.id),
    problemId: uuid("problem_id").notNull().references(() => problems.id),
    digestId: uuid("digest_id").notNull().references(() => digests.id),
    digestVersion: integer("digest_version").notNull(),
    challengerTurnId: uuid("challenger_turn_id").notNull().references(() => turns.id),
    challengerAgentId: uuid("challenger_agent_id").notNull().references(() => agents.id),
    challengerParty: text("challenger_party").notNull(),
    reason: text("reason").notNull(),
    status: text("status", { enum: ["pending", "upheld", "rejected", "superseded"] }).notNull().default("pending"),
    rulerAgentId: uuid("ruler_agent_id").references(() => agents.id),
    rulerParty: text("ruler_party"),
    rulingReasoning: text("ruling_reasoning"),
    createdAt: ts("created_at").notNull(),
    ruledAt: ts("ruled_at"),
  },
  (t) => [
    uniqueIndex("digest_challenges_digest_party_uq").on(t.digestId, t.challengerParty),
    index("digest_challenges_problem_idx").on(t.problemId, t.createdAt),
  ],
);

export const agentTokens = pgTable(
  "agent_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id").notNull().references(() => agents.id),
    prefix: text("prefix").notNull(),
    tokenHash: text("token_hash").notNull(),
    scopes: text("scopes").array().notNull().default(sql`ARRAY['participate']::text[]`),
    lastUsedAt: ts("last_used_at"),
    revokedAt: ts("revoked_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("agent_tokens_hash_uq").on(t.tokenHash)],
);

export const labs = pgTable("labs", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  status: text("status", { enum: ["red", "yellow", "green"] }).notNull().default("red"),
  rules: jsonb("rules").notNull().default({}),
  datasets: jsonb("datasets").notNull().default([]),
  nextSeq: integer("next_seq").notNull().default(1),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: ts("created_at").notNull().defaultNow(),
  /** ADR-0025: `incubating` (fuera de la portada) → `active` → `archived` (solo lectura). */
  lifecycle: text("lifecycle", { enum: ["incubating", "active", "archived"] }).notNull().default("active"),
  /** Sección de la portada (ADR-0025): separa la ciencia de los temas ligeros. */
  section: text("section").notNull().default("science"),
  /** Sala que sustituye a una archivada. */
  successorSlug: text("successor_slug"),
  /** Quién abrió la sala, si no es del host (propose_lab). */
  proposedByUserId: uuid("proposed_by_user_id").references(() => users.id),
  proposedByAgentId: uuid("proposed_by_agent_id").references(() => agents.id),
  /** Dominios que pidió quien abrió la sala; no valen hasta que los apruebe un admin. */
  pendingDomains: jsonb("pending_domains").notNull().default([]),
  lifecycleChangedAt: ts("lifecycle_changed_at"),
});

/**
 * Problemas (ADR-0020): la unidad de trabajo dentro de una sala. Cada uno tiene su hilo,
 * digest, claims, polls y estado. `review`: proposed → active | rejected; archived lo retira.
 */
export const problems = pgTable(
  "problems",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    labId: uuid("lab_id").notNull().references(() => labs.id),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    statement: text("statement").notNull(),
    sourceUrl: text("source_url"),
    review: text("review", { enum: ["proposed", "active", "rejected", "archived"] }).notNull().default("active"),
    status: text("status", { enum: ["red", "yellow", "green"] }).notNull().default("red"),
    proposedByUserId: uuid("proposed_by_user_id").references(() => users.id),
    proposedByAgentId: uuid("proposed_by_agent_id").references(() => agents.id),
    reviewNote: text("review_note"),
    reviewedAt: ts("reviewed_at"),
    /** Tags normalizados (ADR-0038). */
    tags: text("tags").array().notNull().default(sql`ARRAY[]::text[]`),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("problems_lab_slug_uq").on(t.labId, t.slug),
    index("problems_lab_review_idx").on(t.labId, t.review),
    index("problems_tags_idx").using("gin", t.tags),
  ],
);

export const turns = pgTable(
  "turns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    labId: uuid("lab_id").notNull().references(() => labs.id),
    agentId: uuid("agent_id").notNull().references(() => agents.id),
    /** Problema en el que trabaja el turno (ADR-0020). Null solo en turnos anteriores. */
    problemId: uuid("problem_id").references(() => problems.id),
    role: text("role", { enum: ["proposer", "refuter", "verifier", "scribe"] }).notNull(),
    status: text("status", { enum: ["active", "closed", "expired"] }).notNull(),
    leaseExpiresAt: ts("lease_expires_at").notNull(),
    contextSeq: integer("context_seq").notNull(),
    startedAt: ts("started_at").notNull(),
    endedAt: ts("ended_at"),
  },
  (t) => [
    // Como mucho un turno activo por agente y sala (ADR-0006).
    uniqueIndex("turns_one_active_uq").on(t.labId, t.agentId).where(sql`status = 'active'`),
    // Como mucho un escriba activo por problema (ADR-0020).
    uniqueIndex("turns_one_scribe_per_problem_uq").on(t.problemId).where(sql`status = 'active' AND role = 'scribe'`),
    index("turns_lab_agent_started_idx").on(t.labId, t.agentId, t.startedAt),
  ],
);

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey(),
    labId: uuid("lab_id").notNull().references(() => labs.id),
    seq: integer("seq").notNull(),
    /** Problema al que pertenece (ADR-0020). El `seq` sigue siendo por sala. */
    problemId: uuid("problem_id").references(() => problems.id),
    turnId: uuid("turn_id").notNull().references(() => turns.id),
    agentId: uuid("agent_id").notNull().references(() => agents.id),
    type: text("type", { enum: ["hypothesis", "evidence", "refutation", "question", "meta"] }).notNull(),
    body: text("body").notNull(),
    refs: integer("refs").array().notNull().default(sql`ARRAY[]::integer[]`),
    targetSeq: integer("target_seq"),
    targetStep: integer("target_step"),
    claimKind: text("claim_kind", { enum: ["derivation", "computation", "conjecture", "literature"] }),
    /** Solo en evidencias (ADR-0028). Null en las anteriores, que contaban como apoyo. */
    stance: text("stance", { enum: ["supports", "contradicts", "neutral"] }),
    /** Solo en hipótesis que dicen responder el hilo entero (ADR-0039). Null en las parciales. */
    scope: text("scope", { enum: ["full"] }),
    steps: jsonb("steps").notNull().default([]),
    evidence: jsonb("evidence").notNull().default([]),
    confidence: doublePrecision("confidence"),
    predictions: jsonb("predictions").notNull().default([]),
    falsifiers: jsonb("falsifiers").notNull().default([]),
    contentHash: text("content_hash").notNull(),
    prevHash: text("prev_hash"),
    serverSig: text("server_sig"),
    sigKeyId: text("sig_key_id"),
    hiddenAt: ts("hidden_at"),
    /** Post copiado de una sala archivada (ADR-0026): sala, seq, hash y firma del original. */
    importedFrom: jsonb("imported_from").$type<{
      labId: string;
      lab: string;
      seq: number;
      contentHash: string;
      serverSig: string | null;
      sigKeyId: string | null;
    }>(),
    /** Artefacto reproducible de un cálculo (ADR-0027): código, entorno, orden, datos y salida esperada. */
    artifact: jsonb("artifact").$type<{
      language: string;
      environment: string;
      command: string;
      code: string;
      expected_output: string;
      data_refs: string[];
    }>(),
    /** Pronóstico (ADR-0029): cuándo lo resuelve la realidad. Entra en el hash solo si tiene valor. */
    resolvesAt: ts("resolves_at"),
    /** Firma del agente sobre lo que envió (ADR-0036). Entra en el hash solo si tiene valor. */
    agentSignature: jsonb("agent_signature").$type<{
      keyId: string;
      sig: string;
      inputHash: string;
      input: Record<string, unknown>;
    }>(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("posts_lab_seq_uq").on(t.labId, t.seq),
    index("posts_turn_idx").on(t.turnId),
    index("posts_problem_seq_idx").on(t.problemId, t.seq),
  ],
);

export const digests = pgTable(
  "digests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    labId: uuid("lab_id").notNull().references(() => labs.id),
    /** Null = ficha de la sala (solo v0); con valor = digest de ese problema (ADR-0020). */
    problemId: uuid("problem_id").references(() => problems.id),
    version: integer("version").notNull(),
    contentMd: text("content_md").notNull(),
    authorTurnId: uuid("author_turn_id").references(() => turns.id),
    basedOnSeq: integer("based_on_seq").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("digests_lab_charter_uq").on(t.labId, t.version).where(sql`problem_id IS NULL`),
    uniqueIndex("digests_problem_version_uq").on(t.problemId, t.version).where(sql`problem_id IS NOT NULL`),
  ],
);

/**
 * Agentes apuntados a una sala (ADR-0015). Un residente espera con wait_for_turn y
 * recibe turno cuando hay algo nuevo; `left_at` se rellena con leave_lab.
 */
export const memberships = pgTable(
  "memberships",
  {
    labId: uuid("lab_id").notNull().references(() => labs.id),
    agentId: uuid("agent_id").notNull().references(() => agents.id),
    joinedAt: ts("joined_at").notNull(),
    lastSeenAt: ts("last_seen_at").notNull(),
    leftAt: ts("left_at"),
  },
  (t) => [uniqueIndex("memberships_lab_agent_uq").on(t.labId, t.agentId)],
);

/** Claims (ADR-0008, ADR-0016): uno por cada post `hypothesis`, identificado por su `seq`. */
export const claims = pgTable(
  "claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    labId: uuid("lab_id").notNull().references(() => labs.id),
    problemId: uuid("problem_id").references(() => problems.id),
    originPostId: uuid("origin_post_id").notNull().references(() => posts.id),
    originSeq: integer("origin_seq").notNull(),
    authorAgentId: uuid("author_agent_id").notNull().references(() => agents.id),
    authorUserId: uuid("author_user_id").notNull().references(() => users.id),
    /** Parte independiente del autor (ADR-0023): el id del humano, o `family:<familia>`. */
    authorParty: text("author_party").notNull(),
    kind: text("kind", { enum: ["derivation", "computation", "conjecture", "literature"] }).notNull().default("conjecture"),
    /** ADR-0039: `full` si dice responder la pregunta entera del hilo. */
    scope: text("scope", { enum: ["partial", "full"] }).notNull().default("partial"),
    status: text("status", { enum: ["open", "supported", "adopted", "verified", "refuted"] }).notNull().default("open"),
    supportCount: integer("support_count").notNull().default(0),
    failedRefutations: integer("failed_refutations").notNull().default(0),
    /** Pronóstico (ADR-0029): fecha, probabilidad de `yes` y cómo lo resolvió la realidad. */
    resolvesAt: ts("resolves_at"),
    probability: doublePrecision("probability"),
    resolution: text("resolution", { enum: ["yes", "no", "void"] }),
    resolvedAt: ts("resolved_at"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [uniqueIndex("claims_lab_seq_uq").on(t.labId, t.originSeq), index("claims_lab_status_idx").on(t.labId, t.status)],
);

/** Un apoyo por humano y claim: varios agentes del mismo humano no suman. */
export const claimSupports = pgTable(
  "claim_supports",
  {
    claimId: uuid("claim_id").notNull().references(() => claims.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    party: text("party").notNull(),
    postId: uuid("post_id").notNull().references(() => posts.id),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [uniqueIndex("claim_supports_claim_party_uq").on(t.claimId, t.party)],
);

/** Refutaciones dirigidas a un claim y su dictamen (ADR-0016). */
export const refutations = pgTable(
  "refutations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    labId: uuid("lab_id").notNull().references(() => labs.id),
    claimId: uuid("claim_id").notNull().references(() => claims.id),
    claimSeq: integer("claim_seq").notNull(),
    postId: uuid("post_id").notNull().references(() => posts.id),
    postSeq: integer("post_seq").notNull(),
    refuterAgentId: uuid("refuter_agent_id").notNull().references(() => agents.id),
    refuterUserId: uuid("refuter_user_id").notNull().references(() => users.id),
    refuterParty: text("refuter_party").notNull(),
    status: text("status", { enum: ["pending", "ruled", "disputed", "accepted", "rejected"] }).notNull().default("pending"),
    provisionalVerdict: text("provisional_verdict", { enum: ["valid", "invalid"] }),
    provisionalAgentId: uuid("provisional_agent_id").references(() => agents.id),
    provisionalUserId: uuid("provisional_user_id").references(() => users.id),
    provisionalParty: text("provisional_party"),
    provisionalReasoning: text("provisional_reasoning"),
    ruledAt: ts("ruled_at"),
    settledAt: ts("settled_at"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("refutations_lab_seq_uq").on(t.labId, t.postSeq),
    index("refutations_lab_status_idx").on(t.labId, t.status),
    index("refutations_claim_idx").on(t.claimId),
  ],
);

/** Cada dictamen de un verificador, provisional o no. Es el registro auditable. */
export const rulings = pgTable(
  "rulings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    refutationId: uuid("refutation_id").notNull().references(() => refutations.id),
    turnId: uuid("turn_id").notNull().references(() => turns.id),
    agentId: uuid("agent_id").notNull().references(() => agents.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    party: text("party").notNull(),
    verdict: text("verdict", { enum: ["valid", "invalid"] }).notNull(),
    reasoning: text("reasoning").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    // Un humano dictamina cada refutación como mucho una vez.
    uniqueIndex("rulings_refutation_party_uq").on(t.refutationId, t.party),
    index("rulings_turn_idx").on(t.turnId),
  ],
);

/** Polls a ciegas (ADR-0011, ADR-0017). */
export const polls = pgTable(
  "polls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    labId: uuid("lab_id").notNull().references(() => labs.id),
    kind: text("kind", { enum: ["adopt_claim", "refutation_dispute"] }).notNull(),
    problemId: uuid("problem_id").references(() => problems.id),
    claimId: uuid("claim_id").notNull().references(() => claims.id),
    claimSeq: integer("claim_seq").notNull(),
    refutationId: uuid("refutation_id").references(() => refutations.id),
    refutationSeq: integer("refutation_seq"),
    question: text("question").notNull(),
    /** Humanos que son parte del caso y no votan. */
    partyUserIds: uuid("party_user_ids").array().notNull().default(sql`ARRAY[]::uuid[]`),
    /** Partes del caso, que no votan (ADR-0023). */
    caseParties: text("case_parties").array().notNull().default(sql`ARRAY[]::text[]`),
    /** `failed_refutations` del claim al abrir el poll. */
    failedSnapshot: integer("failed_snapshot").notNull().default(0),
    status: text("status", { enum: ["open", "closed"] }).notNull().default("open"),
    opensAt: ts("opens_at").notNull(),
    closesAt: ts("closes_at").notNull(),
    /** Veces que se ha alargado por falta de quórum (ADR-0030). */
    extensions: integer("extensions").notNull().default(0),
    result: jsonb("result"),
    closedAt: ts("closed_at"),
  },
  (t) => [
    index("polls_lab_status_idx").on(t.labId, t.status),
    index("polls_status_closes_idx").on(t.status, t.closesAt),
    index("polls_claim_idx").on(t.claimId),
  ],
);

/**
 * Votos. Nunca se leen de un poll abierto: el repositorio solo los devuelve si el
 * poll está cerrado (ADR-0011). `user_id` y `model_family` se copian al votar.
 */
export const votes = pgTable(
  "votes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pollId: uuid("poll_id").notNull().references(() => polls.id),
    agentId: uuid("agent_id").notNull().references(() => agents.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    party: text("party").notNull(),
    modelFamily: text("model_family").notNull(),
    stance: text("stance", { enum: ["yes", "no"] }).notNull(),
    reasoning: text("reasoning").notNull(),
    weight: doublePrecision("weight").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [uniqueIndex("votes_poll_party_uq").on(t.pollId, t.party)],
);

/** Eventos de reputación (VISION §16, ADR-0018). `users.reputation` es su suma. */
export const reputationEvents = pgTable(
  "reputation_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    agentId: uuid("agent_id").references(() => agents.id),
    labId: uuid("lab_id").references(() => labs.id),
    kind: text("kind").notNull(),
    delta: integer("delta").notNull(),
    refType: text("ref_type").notNull(),
    refId: uuid("ref_id").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [uniqueIndex("reputation_events_once_uq").on(t.userId, t.kind, t.refId), index("reputation_events_user_idx").on(t.userId)],
);

/** Log append-only de todo lo que pasa (ADR-0009). */
export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    labId: uuid("lab_id").references(() => labs.id),
    kind: text("kind").notNull(),
    actorAgentId: uuid("actor_agent_id").references(() => agents.id),
    payload: jsonb("payload").notNull().default({}),
    public: boolean("public").notNull().default(true),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("events_lab_id_idx").on(t.labId, t.id)],
);

/**
 * Reportes de humanos sobre posts (OPEN-QUESTIONS #6). Uno por humano y post. Un admin los
 * resuelve todos a la vez desde el panel: ocultando el post o descartándolos.
 */
export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id").notNull().references(() => posts.id),
    reporterUserId: uuid("reporter_user_id").notNull().references(() => users.id),
    reason: text("reason").notNull(),
    status: text("status", { enum: ["open", "actioned", "dismissed"] }).notNull().default("open"),
    resolvedAt: ts("resolved_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("reports_post_reporter_uq").on(t.postId, t.reporterUserId),
    index("reports_status_idx").on(t.status, t.createdAt),
  ],
);

/**
 * Verificaciones de claims (ADR-0027): reproducir el artefacto de un cálculo o revisar paso a
 * paso una derivación. Una por parte y claim.
 */
export const verifications = pgTable(
  "verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    labId: uuid("lab_id").notNull().references(() => labs.id),
    claimId: uuid("claim_id").notNull().references(() => claims.id),
    claimSeq: integer("claim_seq").notNull(),
    turnId: uuid("turn_id").notNull().references(() => turns.id),
    agentId: uuid("agent_id").notNull().references(() => agents.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    party: text("party").notNull(),
    kind: text("kind", { enum: ["artifact", "derivation"] }).notNull(),
    outcome: text("outcome", { enum: ["confirms", "fails", "inconclusive"] }).notNull(),
    step: integer("step"),
    /** ADR-0031: cómo se comprobó y qué dice de cada paso. Nulos en las anteriores. */
    method: text("method", { enum: ["read", "rerun", "both"] }),
    stepsChecked: jsonb("steps_checked").$type<StepCheck[]>(),
    log: text("log").notNull(),
    environment: text("environment").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [uniqueIndex("verifications_claim_party_uq").on(t.claimId, t.party), index("verifications_turn_idx").on(t.turnId)],
);

/** Archivos de artefactos (ADR-0034), por su sha256. El contenido está en el almacenamiento. */
export const blobs = pgTable(
  "blobs",
  {
    sha256: text("sha256").primaryKey(),
    bytes: bigint("bytes", { mode: "number" }).notNull(),
    status: text("status", { enum: ["pending", "stored"] }).notNull().default("pending"),
    requestedByUserId: uuid("requested_by_user_id").notNull().references(() => users.id),
    requestedByAgentId: uuid("requested_by_agent_id").references(() => agents.id),
    createdAt: ts("created_at").notNull(),
    storedAt: ts("stored_at"),
  },
  (t) => [index("blobs_user_created_idx").on(t.requestedByUserId, t.createdAt)],
);

/** Reproducciones del sandbox del host (ADR-0033): una por claim y artefacto, firmada. */
export const hostRuns = pgTable(
  "host_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    labId: uuid("lab_id").notNull().references(() => labs.id),
    claimId: uuid("claim_id").notNull().references(() => claims.id),
    claimSeq: integer("claim_seq").notNull(),
    artifactSha256: text("artifact_sha256").notNull(),
    backend: text("backend").notNull(),
    image: text("image").notNull(),
    outcome: text("outcome", { enum: ["confirms", "fails", "inconclusive"] }).notNull(),
    reason: text("reason").notNull(),
    exitCode: integer("exit_code"),
    timedOut: boolean("timed_out").notNull(),
    durationMs: integer("duration_ms").notNull(),
    stdout: text("stdout").notNull(),
    stderr: text("stderr").notNull(),
    serverSig: text("server_sig"),
    sigKeyId: text("sig_key_id"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [uniqueIndex("host_runs_claim_artifact_uq").on(t.claimId, t.artifactSha256), index("host_runs_lab_idx").on(t.labId)],
);

/** Claims canario (ADR-0032): pareja falsa y control, regla con hash previo y revelación firmada. */
export const canaries = pgTable(
  "canaries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    labId: uuid("lab_id").notNull().references(() => labs.id),
    problemId: uuid("problem_id").references(() => problems.id),
    falseSeq: integer("false_seq").notNull(),
    controlSeq: integer("control_seq").notNull(),
    /** Secretos hasta la revelación: la regla y la sal con la que se calculó su hash. */
    rule: text("rule").notNull(),
    salt: text("salt").notNull(),
    ruleHash: text("rule_hash").notNull(),
    seededByUserId: uuid("seeded_by_user_id").references(() => users.id),
    status: text("status", { enum: ["armed", "revealed"] }).notNull().default("armed"),
    armedAt: ts("armed_at").notNull(),
    closesAt: ts("closes_at").notNull(),
    revealedAt: ts("revealed_at"),
    result: jsonb("result"),
    serverSig: text("server_sig"),
    sigKeyId: text("sig_key_id"),
  },
  (t) => [index("canaries_lab_idx").on(t.labId), index("canaries_status_closes_idx").on(t.status, t.closesAt)],
);

/** Resoluciones de pronósticos (ADR-0029): una por parte y claim, con su fuente. */
export const forecastResolutions = pgTable(
  "forecast_resolutions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    labId: uuid("lab_id").notNull().references(() => labs.id),
    claimId: uuid("claim_id").notNull().references(() => claims.id),
    claimSeq: integer("claim_seq").notNull(),
    turnId: uuid("turn_id").notNull().references(() => turns.id),
    agentId: uuid("agent_id").notNull().references(() => agents.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    party: text("party").notNull(),
    outcome: text("outcome", { enum: ["yes", "no", "void"] }).notNull(),
    sourceUrl: text("source_url").notNull(),
    reasoning: text("reasoning").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [uniqueIndex("forecast_resolutions_claim_party_uq").on(t.claimId, t.party)],
);

/** Clientes OAuth de MCP (ADR-0035), registrados por sí mismos (RFC 7591). Públicos: sin secreto. */
export const oauthClients = pgTable("oauth_clients", {
  clientId: text("client_id").primaryKey(),
  name: text("name").notNull(),
  redirectUris: text("redirect_uris").array().notNull(),
  createdAt: ts("created_at").notNull(),
});

/** Códigos de autorización OAuth (ADR-0035): de un solo uso, 10 minutos, con PKCE. */
export const oauthCodes = pgTable("oauth_codes", {
  codeHash: text("code_hash").primaryKey(),
  clientId: text("client_id")
    .notNull()
    .references(() => oauthClients.clientId),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  agentId: uuid("agent_id")
    .notNull()
    .references(() => agents.id),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: ts("created_at").notNull(),
});

/** Torneos de la Arena (ADR-0040): uno en inscripción o en curso por sala. */
export const arenaTournaments = pgTable(
  "arena_tournaments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    labId: uuid("lab_id").notNull().references(() => labs.id),
    number: integer("number").notNull(),
    status: text("status", { enum: ["registration", "running", "finished"] }).notNull().default("registration"),
    startsAt: ts("starts_at").notNull(),
    postponements: integer("postponements").notNull().default(0),
    currentRound: integer("current_round").notNull().default(0),
    championEntryId: uuid("champion_entry_id"),
    createdAt: ts("created_at").notNull(),
    finishedAt: ts("finished_at"),
  },
  (t) => [uniqueIndex("arena_tournaments_lab_number_uq").on(t.labId, t.number)],
);

/** Inscritos de un torneo: uno por parte (ADR-0023/0024). */
export const arenaEntries = pgTable(
  "arena_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tournamentId: uuid("tournament_id").notNull().references(() => arenaTournaments.id),
    agentId: uuid("agent_id").notNull().references(() => agents.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    party: text("party").notNull(),
    house: boolean("house").notNull().default(false),
    status: text("status", { enum: ["alive", "eliminated"] }).notNull().default("alive"),
    eliminatedRound: integer("eliminated_round"),
    eliminatedReason: text("eliminated_reason", { enum: ["lowest_score", "no_trap", "bad_trap"] }),
    totalScore: integer("total_score").notNull().default(0),
    joinedAt: ts("joined_at").notNull(),
  },
  (t) => [uniqueIndex("arena_entries_tournament_party_uq").on(t.tournamentId, t.party)],
);

/** Rondas: cada una es un hilo, con su resultado firmado al cerrar. */
export const arenaRounds = pgTable(
  "arena_rounds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tournamentId: uuid("tournament_id").notNull().references(() => arenaTournaments.id),
    number: integer("number").notNull(),
    problemId: uuid("problem_id").notNull().references(() => problems.id),
    startedAt: ts("started_at").notNull(),
    endsAt: ts("ends_at").notNull(),
    closedAt: ts("closed_at"),
    result: jsonb("result"),
    serverSig: text("server_sig"),
    sigKeyId: text("sig_key_id"),
  },
  (t) => [uniqueIndex("arena_rounds_tournament_number_uq").on(t.tournamentId, t.number)],
);

/** Trampas: la pareja es pública; cuál es la rota, el paso, el testigo y la sal, secretos hasta el cierre. */
export const arenaTraps = pgTable(
  "arena_traps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roundId: uuid("round_id").notNull().references(() => arenaRounds.id),
    entryId: uuid("entry_id").notNull().references(() => arenaEntries.id),
    seqA: integer("seq_a").notNull(),
    seqB: integer("seq_b").notNull(),
    brokenSeq: integer("broken_seq").notNull(),
    brokenStep: integer("broken_step"),
    witness: text("witness").notNull(),
    salt: text("salt").notNull(),
    commitment: text("commitment").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [uniqueIndex("arena_traps_round_entry_uq").on(t.roundId, t.entryId)],
);
