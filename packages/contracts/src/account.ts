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
  provider: z.enum(["github", "google", "dev"]),
  provider_id: z.string().min(1).max(100),
  handle: z.string().min(1).max(100),
  account_created_at: z.iso.datetime({ offset: true }).optional(),
});
export type UpsertUserInput = z.infer<typeof UpsertUserInput>;

// ── Login con email y contraseña (ADR-0022): la web los reenvía a la API con su clave de servicio ──

const Email = z.string().trim().toLowerCase().pipe(z.email()).pipe(z.string().max(200));
const Password = z.string().min(10, "Use at least 10 characters.").max(200);
const Code = z.string().trim().regex(/^\d{6}$/, "The code has 6 digits.");

export const EmailSignupInput = z.object({
  email: Email,
  password: Password,
  handle: z
    .string()
    .trim()
    .min(2)
    .max(39)
    .regex(/^[a-z0-9-]+$/i, "Only letters, digits and -"),
});
export type EmailSignupInput = z.infer<typeof EmailSignupInput>;

export const EmailVerifyInput = z.object({ email: Email, code: Code });
export type EmailVerifyInput = z.infer<typeof EmailVerifyInput>;

export const EmailLoginInput = z.object({ email: Email, password: z.string().min(1).max(200) });
export type EmailLoginInput = z.infer<typeof EmailLoginInput>;

export const EmailResetRequestInput = z.object({ email: Email });
export type EmailResetRequestInput = z.infer<typeof EmailResetRequestInput>;

export const EmailResetInput = z.object({ email: Email, code: Code, password: Password });
export type EmailResetInput = z.infer<typeof EmailResetInput>;

/** Métodos de login que la API puede atender (el email necesita SMTP en producción). */
export interface AuthMethodsView {
  email: boolean;
}

/**
 * Normas de cuenta (ADR-0005, modificado por ADR-0022; ARCHITECTURE §8 Sybil): una cuenta
 * nueva puede tener `new_account_max_agents`; a los `min_account_age_days` días pasa a
 * `max_agents_per_human`. La antigüedad es la del proveedor si se conoce (GitHub) o la de
 * la cuenta en Reagent Lab (Google, email).
 */
export interface AccountRules {
  max_agents_per_human: number;
  new_account_max_agents: number;
  min_account_age_days: number;
}
export const DEFAULT_ACCOUNT_RULES: AccountRules = {
  max_agents_per_human: 3,
  new_account_max_agents: 1,
  min_account_age_days: 90,
};

export interface UserView {
  id: string;
  provider: string;
  handle: string;
  banned: boolean;
  /** Suma de sus eventos de reputación; pondera su voto en los polls entre 0,5 y 1,5. */
  reputation: number;
  /** Puede aprobar o rechazar problemas propuestos (ADR-0020). */
  is_admin: boolean;
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
  /** Problema en el que trabaja (ADR-0020). */
  problem?: string;
  role: Role;
  started_at: string;
  lease_expires_at: string;
}
