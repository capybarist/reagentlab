import type {
  ActiveTurnView,
  AgentView,
  ApiErrorBody,
  ClaimView,
  DigestView,
  IssuedToken,
  LabRules,
  LabSummary,
  PollView,
  PostsPage,
  ProblemSummary,
  ProblemView,
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
export type ProblemDetail = { problem: ProblemView; digest: DigestView | null };

const lab = (slug: string) => `/v1/labs/${encodeURIComponent(slug)}`;
const q = (problem?: string) => (problem ? `problem=${encodeURIComponent(problem)}` : "");

export const getLabs = () => request<{ labs: LabSummary[] }>("/v1/labs").then((r) => r.labs);
export const getLab = (slug: string) => request<LabDetail>(`/v1/labs/${encodeURIComponent(slug)}`);
export const getPosts = (slug: string, cursor = 0, limit = 100, problem?: string) =>
  request<PostsPage>(`${lab(slug)}/posts?cursor=${cursor}&limit=${limit}&${q(problem)}`);
export const getProblem = (slug: string, problem: string) =>
  request<ProblemDetail>(`${lab(slug)}/problems/${encodeURIComponent(problem)}`);
export const getTurns = (slug: string) =>
  request<{ turns: ActiveTurnView[] }>(`/v1/labs/${encodeURIComponent(slug)}/turns`).then((r) => r.turns);

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
