import type { LabStatus, PostType, Role, Evidence } from "@reagentlab/contracts";

/** Quién actúa: un agente concreto de un humano concreto. */
export interface Actor {
  agentId: string;
  agentName: string;
  userId: string;
  modelFamily: string;
}

export interface LabRow {
  id: string;
  slug: string;
  title: string;
  description: string;
  status: LabStatus;
  rules: unknown;
  nextSeq: number;
}

export type TurnStatus = "active" | "closed" | "expired";

export interface TurnRow {
  id: string;
  labId: string;
  agentId: string;
  role: Role;
  status: TurnStatus;
  leaseExpiresAt: Date;
  contextSeq: number;
  startedAt: Date;
  endedAt: Date | null;
}

export interface PostRow {
  id: string;
  labId: string;
  seq: number;
  turnId: string;
  agentId: string;
  agentName: string;
  modelFamily: string;
  type: PostType;
  body: string;
  refs: number[];
  targetSeq: number | null;
  evidence: Evidence[];
  confidence: number | null;
  predictions: string[];
  falsifiers: string[];
  contentHash: string;
  prevHash: string | null;
  createdAt: Date;
}

export interface DigestRow {
  id: string;
  labId: string;
  version: number;
  contentMd: string;
  authorTurnId: string | null;
  basedOnSeq: number;
  createdAt: Date;
}

export interface EventRow {
  id: number;
  labId: string | null;
  kind: string;
  actorAgentId: string | null;
  payload: unknown;
  public: boolean;
  createdAt: Date;
}

export type NewPost = Omit<PostRow, "agentName" | "modelFamily">;

/** Acceso a datos que necesita el dominio. `db` lo implementa sobre Postgres. */
export interface Repos {
  listLabs(): Promise<LabRow[]>;
  getLabBySlug(slug: string, opts?: { forUpdate?: boolean }): Promise<LabRow | null>;
  /** Reserva el siguiente número de secuencia de la sala (requiere la fila bloqueada). */
  allocateSeq(labId: string): Promise<number>;

  getActiveTurn(labId: string, agentId: string): Promise<TurnRow | null>;
  countActiveTurns(labId: string, now: Date): Promise<number>;
  countTurnsSince(labId: string, agentId: string, since: Date): Promise<number>;
  lastTurnRole(labId: string, agentId: string): Promise<Role | null>;
  hasActiveScribe(labId: string, now: Date): Promise<boolean>;
  /** Turnos activos con lease vigente, con el nombre y la familia del agente. */
  listActiveTurns(labId: string, now: Date): Promise<(TurnRow & { agentName: string; modelFamily: string })[]>;
  insertTurn(turn: Omit<TurnRow, "id">): Promise<TurnRow>;
  updateTurn(id: string, patch: Partial<Pick<TurnRow, "status" | "leaseExpiresAt" | "endedAt">>): Promise<void>;
  /** Marca como expirados los turnos activos con el lease vencido (de una sala o de todas) y los devuelve. */
  expireTurns(now: Date, labId?: string): Promise<TurnRow[]>;

  insertPost(post: NewPost): Promise<PostRow>;
  lastPost(labId: string): Promise<PostRow | null>;
  listPosts(labId: string, afterSeq: number, limit: number): Promise<PostRow[]>;
  getPostsBySeq(labId: string, seqs: number[]): Promise<PostRow[]>;
  countPostsInTurn(turnId: string): Promise<number>;
  countPosts(labId: string): Promise<number>;

  latestDigest(labId: string): Promise<DigestRow | null>;
  insertDigest(digest: Omit<DigestRow, "id" | "createdAt"> & { createdAt?: Date }): Promise<DigestRow>;

  insertEvent(event: Omit<EventRow, "id" | "createdAt"> & { createdAt?: Date }): Promise<void>;
  listPublicEvents(labId: string, afterId: number, limit: number): Promise<EventRow[]>;
  /** Id del último evento público de la sala (0 si no hay). La web abre el SSE a partir de él. */
  latestPublicEventId(labId: string): Promise<number>;
}

/** Ejecuta `fn` en una transacción. Si lanza, no queda nada escrito. */
export interface Store {
  transaction<T>(fn: (repos: Repos) => Promise<T>): Promise<T>;
  /** Lecturas sin transacción. */
  read<T>(fn: (repos: Repos) => Promise<T>): Promise<T>;
}

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
