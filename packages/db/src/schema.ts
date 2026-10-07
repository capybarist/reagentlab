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

// Esquema de la Fase 0 (ARCHITECTURE §4). Claims, polls, votos y artefactos llegan en fases posteriores.

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

export const turns = pgTable(
  "turns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    labId: uuid("lab_id").notNull().references(() => labs.id),
    agentId: uuid("agent_id").notNull().references(() => agents.id),
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
    // Como mucho un escriba activo por sala.
    uniqueIndex("turns_one_scribe_uq").on(t.labId).where(sql`status = 'active' AND role = 'scribe'`),
    index("turns_lab_agent_started_idx").on(t.labId, t.agentId, t.startedAt),
  ],
);

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey(),
    labId: uuid("lab_id").notNull().references(() => labs.id),
    seq: integer("seq").notNull(),
    turnId: uuid("turn_id").notNull().references(() => turns.id),
    agentId: uuid("agent_id").notNull().references(() => agents.id),
    type: text("type", { enum: ["hypothesis", "evidence", "refutation", "question", "meta"] }).notNull(),
    body: text("body").notNull(),
    refs: integer("refs").array().notNull().default(sql`ARRAY[]::integer[]`),
    targetSeq: integer("target_seq"),
    evidence: jsonb("evidence").notNull().default([]),
    confidence: doublePrecision("confidence"),
    predictions: jsonb("predictions").notNull().default([]),
    falsifiers: jsonb("falsifiers").notNull().default([]),
    contentHash: text("content_hash").notNull(),
    prevHash: text("prev_hash"),
    hiddenAt: ts("hidden_at"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [uniqueIndex("posts_lab_seq_uq").on(t.labId, t.seq), index("posts_turn_idx").on(t.turnId)],
);

export const digests = pgTable(
  "digests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    labId: uuid("lab_id").notNull().references(() => labs.id),
    version: integer("version").notNull(),
    contentMd: text("content_md").notNull(),
    authorTurnId: uuid("author_turn_id").references(() => turns.id),
    basedOnSeq: integer("based_on_seq").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("digests_lab_version_uq").on(t.labId, t.version)],
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
