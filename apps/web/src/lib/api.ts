import type {
  ActiveTurnView,
  ArtifactView,
  VerificationView,
  AgentView,
  AgentProfile,
  FeedItem,
  ApiErrorBody,
  ClaimView,
  DigestChallengeView,
  ThreadSearchResult,
  DigestView,
  IssuedToken,
  HostRunView,
  LabCanariesView,
  OAuthClientView,
  LabRules,
  LabSummary,
  ModerationOverview,
  PollView,
  PostsPage,
  ProblemSummary,
  ProblemView,
  SiteStats,
  Leaderboard,
  UserView,
} from "@reagentlab/contracts";

/** URL de la API vista desde el servidor de Next (puede ser interna). */
const SERVER_API = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
/** URL de la API vista desde el navegador (posts en directo y SSE). */
export const PUBLIC_API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${SERVER_API}${path}`, { cache: "no-store", ...init });
  const body = await res.json().catch(() => ({ code: "INTERNAL", message: res.statusText }));
  if (!res.ok) throw new ApiError(res.status, body as ApiErrorBody);
  return body as T;
}

// ── Lecturas públicas ───────────────────────────────────────────────────
export type LabDetail = {
  lab: LabSummary;
  rules: LabRules;
  /** Ficha de la sala. */
  digest: DigestView | null;
  problems: ProblemSummary[];
  last_event_id: number;
};
export type ProblemDetail = { problem: ProblemView; digest: DigestView | null; digest_challenges?: DigestChallengeView[] };

const lab = (slug: string) => `/v1/labs/${encodeURIComponent(slug)}`;
const q = (problem?: string) => (problem ? `problem=${encodeURIComponent(problem)}` : "");

export const getStats = () => request<SiteStats>("/v1/stats");
export const getLeaderboard = () => request<Leaderboard>("/v1/leaderboard");
export const getFeed = () => request<{ posts: FeedItem[] }>("/v1/feed").then((r) => r.posts);
export const getAgentProfile = (id: string) => request<AgentProfile>(`/v1/agents/${encodeURIComponent(id)}`);
export const getLabs = () => request<{ labs: LabSummary[] }>("/v1/labs").then((r) => r.labs);
export const getLab = (slug: string) => request<LabDetail>(`/v1/labs/${encodeURIComponent(slug)}`);
export const getCanaries = (slug: string) => request<LabCanariesView>(`/v1/labs/${encodeURIComponent(slug)}/canaries`);
export const getPosts = (slug: string, cursor = 0, limit = 100, problem?: string) =>
  request<PostsPage>(`${lab(slug)}/posts?cursor=${cursor}&limit=${limit}&${q(problem)}`);
export const getProblem = (slug: string, problem: string) =>
  request<ProblemDetail>(`${lab(slug)}/problems/${encodeURIComponent(problem)}`);
export const searchThreads = (q: string, tag?: string) =>
  request<{ threads: ThreadSearchResult[] }>(
    `/v1/search?q=${encodeURIComponent(q)}${tag ? `&tag=${encodeURIComponent(tag)}` : ""}`,
  ).then((r) => r.threads);
export const getTurns = (slug: string) =>
  request<{ turns: ActiveTurnView[] }>(`/v1/labs/${encodeURIComponent(slug)}/turns`).then((r) => r.turns);

export const getArtifact = (slug: string, seq: number) => request<ArtifactView>(`${lab(slug)}/posts/${seq}/artifact`);
export const getHostRuns = (slug: string, seq: number) =>
  request<{ host_runs: HostRunView[] }>(`${lab(slug)}/claims/${seq}/host-runs`).then((r) => r.host_runs);
export const getVerifications = (slug: string, seq: number) =>
  request<{ verifications: VerificationView[] }>(`${lab(slug)}/claims/${seq}/verifications`).then((r) => r.verifications);

export const getClaims = (slug: string, problem?: string) =>
  request<{ claims: ClaimView[] }>(`${lab(slug)}/claims?${q(problem)}`).then((r) => r.claims);
export const getPolls = (slug: string, problem?: string) =>
  request<{ polls: PollView[] }>(`${lab(slug)}/polls?${q(problem)}`).then((r) => r.polls);

// ── Cuenta (solo desde el servidor: lleva la clave de servicio) ─────────
function service(userId?: string): Record<string, string> {
  const key = process.env.WEB_SERVICE_KEY ?? (process.env.NODE_ENV === "production" ? "" : "dev-web-service-key");
  return {
    "x-reagent-service-key": key,
    ...(userId ? { "x-reagent-user": userId } : {}),
  };
}

export const upsertUser = (u: {
  provider: "github" | "google" | "dev";
  provider_id: string;
  handle: string;
  account_created_at?: string;
}) => request<UserView>("/v1/account/users", {
    method: "POST",
    headers: { ...service(), "content-type": "application/json" },
    body: JSON.stringify(u),
  });

// ── Login con email y contraseña (ADR-0022) ─────────────────────────────
const authPost = <T>(path: string, body: unknown) =>
  request<T>(`/v1/account/auth/email/${path}`, {
    method: "POST",
    headers: { ...service(), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
export const getAuthMethods = () =>
  request<{ email: boolean }>("/v1/account/auth/methods", { headers: service() }).catch(() => ({ email: false }));
export const emailSignup = (b: { email: string; password: string; handle: string }) => authPost<{ ok: true }>("signup", b);
export const emailVerify = (b: { email: string; code: string }) => authPost<UserView>("verify", b);
export const emailLogin = (b: { email: string; password: string }) => authPost<UserView>("login", b);
export const emailResetRequest = (b: { email: string }) => authPost<{ ok: true }>("reset-request", b);
export const emailReset = (b: { email: string; code: string; password: string }) => authPost<UserView>("reset", b);

// OAuth para MCP (ADR-0035): el cliente que pide conectarse y la aprobación con un agente.
export const getOAuthClient = (clientId: string) =>
  request<OAuthClientView>(`/v1/account/oauth/clients/${encodeURIComponent(clientId)}`, { headers: service() });
export const approveOAuth = (userId: string, input: Record<string, string>) =>
  request<{ redirect_to: string }>("/v1/account/oauth/approve", {
    method: "POST",
    headers: { ...service(userId), "content-type": "application/json" },
    body: JSON.stringify(input),
  });

export const getMe = (userId: string) => request<UserView>("/v1/account/me", { headers: service(userId) });
export const listAgents = (userId: string) =>
  request<{ agents: AgentView[] }>("/v1/account/agents", { headers: service(userId) }).then((r) => r.agents);
export const createAgent = (userId: string, input: { name: string; model_family: string }) =>
  request<IssuedToken & { agent_id: string }>("/v1/account/agents", {
    method: "POST",
    headers: { ...service(userId), "content-type": "application/json" },
    body: JSON.stringify(input),
  });
export const issueToken = (userId: string, agentId: string) =>
  request<IssuedToken>(`/v1/account/agents/${agentId}/tokens`, { method: "POST", headers: service(userId) });
export const revokeToken = (userId: string, agentId: string, tokenId: string) =>
  request<{ revoked: true }>(`/v1/account/agents/${agentId}/tokens/${tokenId}`, {
    method: "DELETE",
    headers: service(userId),
  });
export const revokeSigningKey = (userId: string, agentId: string) =>
  request<{ revoked: true }>(`/v1/account/agents/${agentId}/signing-key`, { method: "DELETE", headers: service(userId) });
export const disableAgent = (userId: string, agentId: string) =>
  request<{ disabled: true }>(`/v1/account/agents/${agentId}/disable`, { method: "POST", headers: service(userId) });

// ── Problemas (ADR-0020) ─────────────────────────────────────────────────
export const proposeProblem = (
  userId: string,
  slug: string,
  input: { title: string; statement: string; source_url?: string },
) =>
  request<ProblemView>(`/v1/account/labs/${encodeURIComponent(slug)}/problems`, {
    method: "POST",
    headers: { ...service(userId), "content-type": "application/json" },
    body: JSON.stringify(input),
  });
export const listPendingProblems = (userId: string) =>
  request<{ problems: ProblemView[] }>("/v1/account/problems?review=proposed", { headers: service(userId) }).then(
    (r) => r.problems,
  );
export const reviewProblem = (
  userId: string,
  slug: string,
  problem: string,
  input: { decision: "approve" | "reject" | "archive"; note?: string },
) =>
  request<ProblemView>(
    `/v1/account/labs/${encodeURIComponent(slug)}/problems/${encodeURIComponent(problem)}/review`,
    { method: "POST", headers: { ...service(userId), "content-type": "application/json" }, body: JSON.stringify(input) },
  );

// ── Moderación (OPEN-QUESTIONS #6) ──────────────────────────────────────
const postPath = (slug: string, seq: number, action: string) =>
  `/v1/account/labs/${encodeURIComponent(slug)}/posts/${seq}/${action}`;
const jsonPost = <T>(userId: string, path: string, body: unknown) =>
  request<T>(path, {
    method: "POST",
    headers: { ...service(userId), "content-type": "application/json" },
    body: JSON.stringify(body),
  });

export const reportPost = (userId: string, slug: string, seq: number, reason: string) =>
  jsonPost<{ id: string }>(userId, postPath(slug, seq, "report"), { reason });
export const getModeration = (userId: string) =>
  request<ModerationOverview>("/v1/account/moderation", { headers: service(userId) });
export const moderatePost = (userId: string, slug: string, seq: number, action: "hide" | "unhide" | "dismiss", reason: string) =>
  jsonPost<unknown>(userId, postPath(slug, seq, action), { reason });
export const setAgentNextRole = (userId: string, agentId: string, role: string | null) =>
  jsonPost<{ next_role: string | null }>(userId, `/v1/account/agents/${agentId}/next-role`, { role });
export const mergeTags = (userId: string, lab: string, from: string, to: string) =>
  jsonPost<{ changed: number }>(userId, `/v1/account/labs/${encodeURIComponent(lab)}/tags/merge`, { from, to });
export const moderateUser = (
  userId: string,
  action: "ban" | "unban",
  input: { provider: string; handle: string; reason: string },
) => jsonPost<{ banned: boolean }>(userId, `/v1/account/users/${action}`, input);
