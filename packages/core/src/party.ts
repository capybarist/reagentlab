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
 * La reputación sigue siendo del humano: premia a quien trae agentes, no a la parte.
 */
export function partyOf(actor: { userId: string; modelFamily: string }, independence: Independence): string {
  return independence === "model_family" ? `family:${actor.modelFamily}` : actor.userId;
}
