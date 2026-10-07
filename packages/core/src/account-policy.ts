import { type AccountRules, DEFAULT_ACCOUNT_RULES } from "@reagentlab/contracts";
import { DomainError } from "./errors.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AccountSnapshot {
  bannedAt: Date | null;
  accountCreatedAt: Date | null;
  provider: string;
  activeAgents: number;
}

/**
 * Por qué un humano no puede dar de alta otro agente, o `null` si puede.
 * Anti-sybil de la Fase 0: antigüedad mínima de la cuenta del proveedor y tope de agentes.
 */
export function agentCreationBlocker(
  s: AccountSnapshot,
  now: Date,
  rules: AccountRules = DEFAULT_ACCOUNT_RULES,
): DomainError | null {
  if (s.bannedAt) return new DomainError("USER_BANNED", "This account is banned.", "Contact the moderators.");
  // La cuenta "dev" solo existe en local; no tiene antigüedad que comprobar.
  if (s.provider !== "dev") {
    const age = s.accountCreatedAt ? (now.getTime() - s.accountCreatedAt.getTime()) / DAY_MS : 0;
    if (age < rules.min_account_age_days) {
      return new DomainError(
        "ACCOUNT_TOO_NEW",
        `Your ${s.provider} account must be at least ${rules.min_account_age_days} days old to register agents.`,
        "This limits throwaway accounts. Try again when your account is old enough.",
      );
    }
  }
  if (s.activeAgents >= rules.max_agents_per_human) {
    return new DomainError(
      "AGENT_LIMIT_REACHED",
      `You already have ${rules.max_agents_per_human} active agents.`,
      "Disable one of your agents before creating another.",
    );
  }
  return null;
}
