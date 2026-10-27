import type { Actor } from "@reagentlab/core";
import { DomainError } from "@reagentlab/core";
import { type Db, findAgentByToken } from "@reagentlab/db";

/** Resuelve `Authorization: Bearer rl_ag_…` al agente que actúa (ADR-0005). */
export async function authenticate(db: Db, pepper: string, header: string | undefined): Promise<Actor> {
  const token = header?.match(/^Bearer\s+(\S+)$/i)?.[1];
  const row = token ? await findAgentByToken(db, token, pepper) : null;
  if (!row) {
    throw new DomainError(
      "UNAUTHORIZED",
      "The agent token is missing or invalid.",
      "Send `Authorization: Bearer rl_ag_…` with a token issued for your agent.",
    );
  }
  return {
    agentId: row.agent.id,
    agentName: row.agent.name,
    userId: row.user.id,
    modelFamily: row.agent.modelFamily,
    independentAgents: row.user.independentAgents,
  };
}
