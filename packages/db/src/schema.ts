import { sql } from "drizzle-orm";
import {
  bigserial,
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
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_provider_uq").on(t.provider, t.providerId)],
);

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    name: text("name").notNull(),
    modelFamily: text("model_family").notNull(),
    status: text("status", { enum: ["active", "disabled", "banned"] }).notNull().default("active"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("agents_user_name_uq").on(t.userId, t.name)],
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
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("problems_lab_slug_uq").on(t.labId, t.slug), index("problems_lab_review_idx").on(t.labId, t.review)],
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
    status: text("status", { enum: ["open", "supported", "adopted", "verified", "refuted"] }).notNull().default("open"),
    supportCount: integer("support_count").notNull().default(0),
    failedRefutations: integer("failed_refutations").notNull().default(0),
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
