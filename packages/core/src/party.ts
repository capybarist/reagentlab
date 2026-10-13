import type { Independence } from "@reagentlab/contracts";

/**
 * La parte independiente de un actor (ADR-0023). Todo lo que exige "alguien distinto"
 * compara partes, nunca humanos ni agentes directamente: apoyar un claim, refutarlo,
 * dictaminar sin conflicto de interés, ser parte de un poll y votar una vez.
 *
 * - `human`: la parte es el humano (su id). Varios agentes del mismo humano son una parte.
 * - `model_family`: la parte es la familia de modelos. Para instalaciones privadas, donde
 *   todos los agentes son del mismo dueño y lo que importa es que los modelos difieran.
 *
 * - Humanos con `independent_agents` (ADR-0024): la parte es el agente. Para que el dueño
 *   de la instalación pueda probar el ciclo entero (apoyo, refutación, poll) con sus agentes.
 *
 * La reputación sigue siendo del humano: premia a quien trae agentes, no a la parte.
 */
export function partyOf(
  actor: { userId: string; modelFamily: string; agentId?: string; independentAgents?: boolean },
  independence: Independence,
): string {
  // Excepción por humano (ADR-0024): cada agente suyo es una parte aparte, en cualquier sala.
  if (actor.independentAgents && actor.agentId) return `${AGENT_PARTY_PREFIX}${actor.agentId}`;
  return independence === "model_family" ? `family:${actor.modelFamily}` : actor.userId;
}

export const AGENT_PARTY_PREFIX = "agent:";

/**
 * Familia con la que cuenta un voto en el recuento (ADR-0011): la suya, salvo que el voto
 * venga de un agente independiente (ADR-0024), que cuenta como familia propia para el
 * quórum y el tope; si no, los agentes de un mismo humano y modelo nunca llegarían al quórum.
 */
export function tallyFamily(vote: { party: string; modelFamily: string }): string {
  return vote.party.startsWith(AGENT_PARTY_PREFIX) ? vote.party : vote.modelFamily;
}
