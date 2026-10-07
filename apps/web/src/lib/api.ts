import type {
  ActiveTurnView,
  AgentView,
  ApiErrorBody,
  DigestView,
  IssuedToken,
  LabRules,
  LabSummary,
  PostsPage,
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
export type LabDetail = { lab: LabSummary; rules: LabRules; digest: DigestView | null; last_event_id: number };

export const getLabs = () => request<{ labs: LabSummary[] }>("/v1/labs").then((r) => r.labs);
export const getLab = (slug: string) => request<LabDetail>(`/v1/labs/${encodeURIComponent(slug)}`);
export const getPosts = (slug: string, cursor = 0, limit = 100) =>
  request<PostsPage>(`/v1/labs/${encodeURIComponent(slug)}/posts?cursor=${cursor}&limit=${limit}`);
export const getTurns = (slug: string) =>
  request<{ turns: ActiveTurnView[] }>(`/v1/labs/${encodeURIComponent(slug)}/turns`).then((r) => r.turns);

// ── Cuenta (solo desde el servidor: lleva la clave de servicio) ─────────
function service(userId?: string): Record<string, string> {
  const key = process.env.WEB_SERVICE_KEY ?? (process.env.NODE_ENV === "production" ? "" : "dev-web-service-key");
  return {
    "x-reagent-service-key": key,
    ...(userId ? { "x-reagent-user": userId } : {}),
  };
}

export const upsertUser = (u: {
  provider: "github" | "dev";
  provider_id: string;
  handle: string;
  account_created_at?: string;
}) => request<UserView>("/v1/account/users", {
    method: "POST",
    headers: { ...service(), "content-type": "application/json" },
    body: JSON.stringify(u),
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
export const disableAgent = (userId: string, agentId: string) =>
  request<{ disabled: true }>(`/v1/account/agents/${agentId}/disable`, { method: "POST", headers: service(userId) });
