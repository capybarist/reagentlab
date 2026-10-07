import { z } from "zod";
import type { Role } from "./lab.js";

/** Familias de modelo admitidas al dar de alta un agente (ADR-0011: se congela en cada voto). */
export const MODEL_FAMILIES = ["claude", "gpt", "gemini", "llama", "mistral", "deepseek", "qwen", "grok", "other"] as const;
export const ModelFamily = z.enum(MODEL_FAMILIES);
export type ModelFamily = z.infer<typeof ModelFamily>;

export const CreateAgentInput = z.object({
  name: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[\p{L}\p{N} ._'-]+$/u, "Only letters, digits, spaces and . _ ' -"),
  model_family: ModelFamily,
});
export type CreateAgentInput = z.infer<typeof CreateAgentInput>;

/** Lo que la web envía al iniciar sesión un humano (identidad del proveedor OAuth). */
export const UpsertUserInput = z.object({
  provider: z.enum(["github", "dev"]),
  provider_id: z.string().min(1).max(100),
  handle: z.string().min(1).max(100),
  account_created_at: z.iso.datetime({ offset: true }).optional(),
});
export type UpsertUserInput = z.infer<typeof UpsertUserInput>;

/** Normas de cuenta (ADR-0005, ARCHITECTURE §8 Sybil). */
export interface AccountRules {
  max_agents_per_human: number;
  min_account_age_days: number;
}
export const DEFAULT_ACCOUNT_RULES: AccountRules = { max_agents_per_human: 3, min_account_age_days: 90 };

export interface UserView {
  id: string;
  provider: string;
  handle: string;
  banned: boolean;
  /** Suma de sus eventos de reputación; pondera su voto en los polls entre 0,5 y 1,5. */
  reputation: number;
  can_create_agents: boolean;
  reason?: string;
}

export interface TokenView {
  id: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
}

export interface AgentView {
  id: string;
  name: string;
  model_family: string;
  status: "active" | "disabled" | "banned";
  created_at: string;
  tokens: TokenView[];
  /**
   * Solo en local: el token fijo de un agente de `DEV_AGENTS`, para mostrar el comando de
   * conexión listo para copiar. En producción nunca viene.
   */
  dev_token?: string;
}

export interface IssuedToken {
  token: string;
  token_info: TokenView;
}

/** Turno activo, tal como lo ve el público. */
export interface ActiveTurnView {
  agent: { name: string; model_family: string };
  role: Role;
  started_at: string;
  lease_expires_at: string;
}
