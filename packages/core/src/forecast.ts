import type { ForecastOutcome } from "@reagentlab/contracts";

/**
 * Pronósticos (ADR-0029), funciones puras. Una hipótesis con fecha es un pronóstico; pasada
 * la fecha, partes distintas del autor dicen qué pasó y el pronóstico se resuelve cuando un
 * resultado saca a los demás la ventaja que pide la sala.
 */

export type ForecastBlock = "not_a_forecast" | "not_due" | "resolved" | "conflict_of_interest" | "already_resolved";

/** ¿Puede esta parte resolver el pronóstico ahora? Nunca la del autor, y cada parte una vez. */
export function resolutionBlock(
  claim: { resolvesAt: Date | null; resolution: ForecastOutcome | null; authorParty: string },
  party: string,
  partiesThatResolved: readonly string[],
  now: Date,
): ForecastBlock | null {
  if (!claim.resolvesAt) return "not_a_forecast";
  if (claim.resolution) return "resolved";
  if (claim.resolvesAt.getTime() > now.getTime()) return "not_due";
  if (party === claim.authorParty) return "conflict_of_interest";
  if (partiesThatResolved.includes(party)) return "already_resolved";
  return null;
}

export type ForecastTally = Record<ForecastOutcome, number>;

/** Recuento por parte: cada parte cuenta una vez. */
export function forecastTally(resolutions: readonly { party: string; outcome: ForecastOutcome }[]): ForecastTally {
  const byParty = new Map<string, ForecastOutcome>();
  for (const r of resolutions) if (!byParty.has(r.party)) byParty.set(r.party, r.outcome);
  const t: ForecastTally = { yes: 0, no: 0, void: 0 };
  for (const o of byParty.values()) t[o]++;
  return t;
}

/**
 * El resultado que gana: el que supera al siguiente en `required` partes o más. Así un
 * desacuerdo no se zanja con la primera opinión: hace falta que más partes coincidan.
 */
export function forecastDecision(t: ForecastTally, required: number): ForecastOutcome | null {
  const ranked = (Object.entries(t) as [ForecastOutcome, number][]).sort((a, b) => b[1] - a[1]);
  const [first, second] = ranked;
  return first![1] - second![1] >= required ? first![0] : null;
}

/** Brier de un pronóstico: (p − y)². Null si se anuló o aún no se ha resuelto. */
export function brierScore(probability: number | null, outcome: ForecastOutcome | null): number | null {
  if (probability === null || (outcome !== "yes" && outcome !== "no")) return null;
  const y = outcome === "yes" ? 1 : 0;
  return (probability - y) ** 2;
}

/** Un pronóstico se publica con fecha futura y dentro del horizonte de la sala. */
export function forecastDateIssue(resolvesAt: Date, now: Date, maxDays: number): string | null {
  const ms = resolvesAt.getTime() - now.getTime();
  if (ms < 60 * 60 * 1000) return "resolves_at tiene que estar al menos una hora en el futuro.";
  if (ms > maxDays * 24 * 60 * 60 * 1000) return `resolves_at no puede estar a más de ${maxDays} días.`;
  return null;
}
