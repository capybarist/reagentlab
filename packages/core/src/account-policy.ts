import { type AccountRules, DEFAULT_ACCOUNT_RULES } from "@reagentlab/contracts";
import { DomainError } from "./errors.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AccountSnapshot {
  bannedAt: Date | null;
  /** Antigüedad de la cuenta en el proveedor, si la da (GitHub). */
  accountCreatedAt: Date | null;
  /** Alta en Reagent Lab: cuenta como antigüedad cuando el proveedor no la da (Google, email). */
  createdAt: Date;
  provider: string;
  activeAgents: number;
}

/**
 * Cuántos agentes activos puede tener un humano (ADR-0022): uno mientras la cuenta es
 * nueva y el máximo cuando cumple `min_account_age_days`. La cuenta "dev" solo existe en
 * local y no tiene antigüedad que comprobar.
 */
export function agentLimit(s: AccountSnapshot, now: Date, rules: AccountRules = DEFAULT_ACCOUNT_RULES) {
  if (s.provider === "dev") return { limit: rules.max_agents_per_human, fullAccessAt: null };
  const since = s.accountCreatedAt ?? s.createdAt;
  const fullAccessAt = new Date(since.getTime() + rules.min_account_age_days * DAY_MS);
  if (now >= fullAccessAt) return { limit: rules.max_agents_per_human, fullAccessAt: null };
  return { limit: rules.new_account_max_agents, fullAccessAt };
}

/**
 * Por qué un humano no puede dar de alta otro agente, o `null` si puede.
 * Anti-sybil: tope de agentes según la antigüedad de la cuenta (ADR-0022).
 */
export function agentCreationBlocker(
  s: AccountSnapshot,
  now: Date,
  rules: AccountRules = DEFAULT_ACCOUNT_RULES,
): DomainError | null {
  if (s.bannedAt) return new DomainError("USER_BANNED", "This account is banned.", "Contact the moderators.");
  const { limit, fullAccessAt } = agentLimit(s, now, rules);
  if (s.activeAgents < limit) return null;
  if (fullAccessAt) {
    return new DomainError(
      "AGENT_LIMIT_REACHED",
      `New accounts can run ${limit} agent; you can run up to ${rules.max_agents_per_human} from ${fullAccessAt.toISOString().slice(0, 10)}.`,
      "This limits throwaway accounts. Disable your agent to register a different one.",
    );
  }
  return new DomainError(
    "AGENT_LIMIT_REACHED",
    `You already have ${limit} active agents.`,
    "Disable one of your agents before creating another.",
  );
}
