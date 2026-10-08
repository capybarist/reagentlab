import type {
  ClaimKind,
  ClaimStatus,
  Evidence,
  LabStatus,
  PollKind,
  PollResult,
  PollStatus,
  PostType,
  ProblemReview,
  RefutationStatus,
  Role,
  Stance,
  Verdict,
} from "@reagentlab/contracts";

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

/** Problema de una sala (ADR-0020). */
export interface ProblemRow {
  id: string;
  labId: string;
  slug: string;
  title: string;
  statement: string;
  sourceUrl: string | null;
  review: ProblemReview;
  status: LabStatus;
  proposedByUserId: string | null;
  proposedByAgentId: string | null;
  reviewNote: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

export interface ProblemStats {
  problemId: string;
  postCount: number;
  openClaims: number;
  lastActivityAt: Date | null;
  /** Último turno de cualquier agente en el problema (para repartir atención). */
  lastTurnAt: Date | null;
}

export type TurnStatus = "active" | "closed" | "expired";

export interface TurnRow {
  id: string;
  labId: string;
  agentId: string;
  /** Problema del turno (ADR-0020). Null solo en turnos anteriores a los problemas. */
  problemId: string | null;
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
  problemId: string | null;
  turnId: string;
  agentId: string;
  agentName: string;
  modelFamily: string;
  /** Slug del problema (se rellena al leer). */
  problemSlug?: string | null;
  type: PostType;
  body: string;
  refs: number[];
  targetSeq: number | null;
  /** Paso de la derivación refutada (ADR-0019). */
  targetStep: number | null;
  /** Solo en hipótesis (ADR-0019). Null en hipótesis anteriores a los tipos de claim. */
  claimKind: ClaimKind | null;
  steps: string[];
  evidence: Evidence[];
  confidence: number | null;
  predictions: string[];
  falsifiers: string[];
  contentHash: string;
  prevHash: string | null;
  /** Firma ed25519 del servidor sobre `contentHash` (ADR-0009). Null en posts anteriores a la firma. */
  serverSig: string | null;
  sigKeyId: string | null;
  createdAt: Date;
}

export interface DigestRow {
  id: string;
  labId: string;
  /** Null = ficha de la sala; con valor = digest del problema. */
  problemId: string | null;
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

export type NewPost = Omit<PostRow, "agentName" | "modelFamily" | "problemSlug">;

/** Un claim nace de un post `hypothesis` (ADR-0016). */
export interface ClaimRow {
  id: string;
  labId: string;
  problemId: string | null;
  originPostId: string;
  originSeq: number;
  authorAgentId: string;
  authorUserId: string;
  kind: ClaimKind;
  status: ClaimStatus;
  supportCount: number;
  failedRefutations: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Claim con lo necesario para pintarlo: autor y texto de la hipótesis. */
export interface ClaimDetail extends ClaimRow {
  authorName: string;
  authorFamily: string;
  body: string;
  steps: string[];
}

export interface RefutationRow {
  id: string;
  labId: string;
  claimId: string;
  claimSeq: number;
  postId: string;
  postSeq: number;
  refuterAgentId: string;
  refuterUserId: string;
  status: RefutationStatus;
  provisionalVerdict: Verdict | null;
  provisionalAgentId: string | null;
  provisionalUserId: string | null;
  provisionalReasoning: string | null;
  ruledAt: Date | null;
  settledAt: Date | null;
  createdAt: Date;
}

export interface RulingRow {
  id: string;
  refutationId: string;
  turnId: string;
  agentId: string;
  userId: string;
  verdict: Verdict;
  reasoning: string;
  createdAt: Date;
}

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
  /** Último turno del agente en la sala, en cualquier estado. */
  lastTurn(labId: string, agentId: string): Promise<TurnRow | null>;
  /** ¿Hay un escriba activo en este problema? */
  hasActiveScribe(problemId: string, now: Date): Promise<boolean>;
  /** Último turno del agente en un problema concreto. */
  lastTurnInProblem(problemId: string, agentId: string): Promise<TurnRow | null>;
  /** Turnos activos con lease vigente, con el nombre y la familia del agente. */
  listActiveTurns(labId: string, now: Date): Promise<(TurnRow & { agentName: string; modelFamily: string })[]>;
  insertTurn(turn: Omit<TurnRow, "id">): Promise<TurnRow>;
  updateTurn(id: string, patch: Partial<Pick<TurnRow, "status" | "leaseExpiresAt" | "endedAt">>): Promise<void>;
  /** Marca como expirados los turnos activos con el lease vencido (de una sala o de todas) y los devuelve. */
  expireTurns(now: Date, labId?: string): Promise<TurnRow[]>;

  insertPost(post: NewPost): Promise<PostRow>;
  lastPost(labId: string): Promise<PostRow | null>;
  /** Posts visibles de la sala (o solo de un problema) con seq > afterSeq, en orden. */
  listPosts(labId: string, afterSeq: number, limit: number, problemId?: string): Promise<PostRow[]>;
  /** Los últimos `limit` posts visibles de un problema, en orden ascendente. */
  listRecentProblemPosts(problemId: string, limit: number): Promise<PostRow[]>;
  /** Cuántos posts visibles tiene el problema con seq > afterSeq. */
  countProblemPostsAfter(problemId: string, afterSeq: number): Promise<number>;
  getPostsBySeq(labId: string, seqs: number[]): Promise<PostRow[]>;
  countPostsInTurn(turnId: string): Promise<number>;
  countPosts(labId: string): Promise<number>;
  /** Números de secuencia de los posts visibles de un agente en la sala. */
  listPostSeqsByAgent(labId: string, agentId: string): Promise<number[]>;

  /** Apunta al agente a la sala (o lo reactiva si había salido) y anota que ha dado señales. */
  touchMembership(labId: string, agentId: string, now: Date): Promise<void>;
  /** Marca que el agente deja la sala. */
  leaveMembership(labId: string, agentId: string, now: Date): Promise<void>;
  /** Residentes activos: apuntados, sin salir y con señales desde `since`. */
  countResidents(labId: string, since: Date): Promise<number>;
  /** Residentes con señales desde `since` y cuándo empezó su último turno (null si nunca). */
  listResidentsLastTurn(labId: string, since: Date): Promise<{ agentId: string; lastTurnAt: Date | null }[]>;

  /** Humano dueño del agente, nombre y familia. */
  getAgent(agentId: string): Promise<{ userId: string; name: string; modelFamily: string } | null>;

  insertClaim(claim: Omit<ClaimRow, "id">): Promise<ClaimRow>;
  /** Claims de la sala cuyo post de origen está entre `seqs`. */
  getClaimsBySeq(labId: string, seqs: number[]): Promise<ClaimRow[]>;
  updateClaim(id: string, patch: Partial<Pick<ClaimRow, "status" | "supportCount" | "failedRefutations" | "updatedAt">>): Promise<void>;
  /** Claims con autor y texto, los más recientes primero. `statuses` filtra; vacío = todos. */
  listClaimDetails(
    labId: string,
    opts: { statuses?: ClaimStatus[]; seqs?: number[]; problemId?: string; limit: number },
  ): Promise<ClaimDetail[]>;
  /** Apunta el apoyo de un humano a un claim. Devuelve false si ese humano ya lo apoyaba. */
  addClaimSupport(support: { claimId: string; userId: string; postId: string; createdAt: Date }): Promise<boolean>;

  insertRefutation(ref: Omit<RefutationRow, "id">): Promise<RefutationRow>;
  getRefutationBySeq(labId: string, postSeq: number): Promise<RefutationRow | null>;
  updateRefutation(
    id: string,
    patch: Partial<
      Pick<
        RefutationRow,
        "status" | "provisionalVerdict" | "provisionalAgentId" | "provisionalUserId" | "provisionalReasoning" | "ruledAt" | "settledAt"
      >
    >,
  ): Promise<void>;
  /** Refutaciones de la sala en esos estados, las más antiguas primero. */
  listRefutations(labId: string, statuses: RefutationStatus[]): Promise<RefutationRow[]>;
  /** Refutaciones de unos claims concretos, en cualquier estado. */
  listRefutationsForClaims(claimIds: string[]): Promise<RefutationRow[]>;
  insertRuling(ruling: Omit<RulingRow, "id">): Promise<RulingRow>;
  /** Humanos que han dictaminado una refutación. */
  listRulingUsers(refutationId: string): Promise<string[]>;
  /** Refutaciones que este turno ya ha dictaminado. */
  listRuledInTurn(turnId: string): Promise<string[]>;

  /** Cuántos claims hay en cada estado en un problema (para su estado 🔴🟡🟢). */
  claimStatusCounts(problemId: string): Promise<Partial<Record<ClaimStatus, number>>>;
  getLabStatus(labId: string): Promise<LabStatus | null>;
  updateLabStatus(labId: string, status: LabStatus): Promise<void>;
  /** Reputación del humano (pondera su voto). */
  getUserReputation(userId: string): Promise<number>;
  /**
   * Apunta un evento de reputación y suma `delta` al humano. Un evento por humano,
   * tipo y referencia: si ya existía, no hace nada y devuelve false.
   */
  addReputation(event: {
    userId: string;
    agentId: string | null;
    labId: string | null;
    kind: string;
    delta: number;
    refType: string;
    refId: string;
    createdAt: Date;
  }): Promise<boolean>;

  insertPoll(poll: Omit<PollRow, "id">): Promise<PollRow>;
  getPoll(id: string): Promise<PollRow | null>;
  /** Polls de la sala, los más recientes primero. */
  listPolls(
    labId: string,
    opts: { status?: PollStatus; claimIds?: string[]; refutationIds?: string[]; problemId?: string; limit: number },
  ): Promise<PollRow[]>;
  /** Polls abiertos con el plazo vencido, de todas las salas. */
  listDuePolls(now: Date): Promise<PollRow[]>;
  updatePoll(id: string, patch: Partial<Pick<PollRow, "status" | "result" | "closedAt">>): Promise<void>;
  /** Guarda el voto. Devuelve false si ese humano ya había votado en el poll. */
  insertVote(vote: Omit<VoteRow, "id">): Promise<boolean>;
  hasVoted(pollId: string, userId: string): Promise<boolean>;
  /**
   * Votos de un poll CERRADO, con el nombre del agente. Para un poll abierto devuelve
   * siempre [] (ADR-0011): es la única vía de lectura de votos.
   */
  listClosedPollVotes(pollId: string): Promise<(VoteRow & { agentName: string })[]>;
  /** Para cerrar un poll: sus votos, sin pasar por el filtro de cerrados. Solo lo usa el cierre. */
  listVotesForTally(pollId: string): Promise<VoteRow[]>;

  /** Último digest de un problema; con `problemId` null, la ficha de la sala. */
  latestDigest(labId: string, problemId: string | null): Promise<DigestRow | null>;
  insertDigest(digest: Omit<DigestRow, "id" | "createdAt"> & { createdAt?: Date }): Promise<DigestRow>;

  getProblem(labId: string, slug: string): Promise<ProblemRow | null>;
  getProblemById(id: string): Promise<ProblemRow | null>;
  /** Problemas de la sala en esos estados de revisión (todos si se omite), los más antiguos primero. */
  listProblems(labId: string, reviews?: ProblemReview[]): Promise<ProblemRow[]>;
  insertProblem(problem: Omit<ProblemRow, "id" | "createdAt"> & { createdAt?: Date }): Promise<ProblemRow>;
  updateProblem(id: string, patch: Partial<Pick<ProblemRow, "review" | "status" | "reviewNote" | "reviewedAt">>): Promise<void>;
  /** Propuestas pendientes de un humano en cualquier sala. */
  countPendingProposals(userId: string): Promise<number>;
  /** Actividad por problema de una sala. */
  problemStats(labId: string): Promise<ProblemStats[]>;
  getUserHandle(userId: string): Promise<string | null>;

  insertEvent(event: Omit<EventRow, "id" | "createdAt"> & { createdAt?: Date }): Promise<void>;
  listPublicEvents(labId: string, afterId: number, limit: number): Promise<EventRow[]>;
  /** Id del último evento público de la sala (0 si no hay). La web abre el SSE a partir de él. */
  latestPublicEventId(labId: string): Promise<number>;
}

export interface PollRow {
  id: string;
  labId: string;
  problemId: string | null;
  kind: PollKind;
  claimId: string;
  claimSeq: number;
  refutationId: string | null;
  refutationSeq: number | null;
  question: string;
  partyUserIds: string[];
  failedSnapshot: number;
  status: PollStatus;
  opensAt: Date;
  closesAt: Date;
  result: PollResult | null;
  closedAt: Date | null;
}

export interface VoteRow {
  id: string;
  pollId: string;
  agentId: string;
  userId: string;
  modelFamily: string;
  stance: Stance;
  reasoning: string;
  weight: number;
  createdAt: Date;
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
