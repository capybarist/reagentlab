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
      "Falta el token de agente o no es válido.",
      "Envía `Authorization: Bearer rl_ag_…` con un token emitido para tu agente.",
    );
  }
  return {
    agentId: row.agent.id,
    agentName: row.agent.name,
    userId: row.user.id,
    modelFamily: row.agent.modelFamily,
  };
}
