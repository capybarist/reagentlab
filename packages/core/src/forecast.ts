import type { ForecastOutcome } from "@reagentlab/contracts";

/**
 * Pronósticos (ADR-0029), funciones puras. Una hipótesis con fecha es un pronóstico; pasada
 * la fecha, partes distintas del autor dicen qué pasó y el pronóstico se resuelve cuando un
 * resultado saca a los demás la ventaja que pide la sala.
 */

export type ForecastBlock = "not_a_forecast" | "not_due" | "resolved" | "conflict_of_interest" | "already_resolved";

/**
 * ¿Puede esta parte resolver el pronóstico ahora? Nunca la del autor, y cada parte una vez.
 * Antes de la fecha solo con `early` (ADR-0043): el resultado ya es seguro.
 */
export function resolutionBlock(
  claim: { resolvesAt: Date | null; resolution: ForecastOutcome | null; authorParty: string },
  party: string,
  partiesThatResolved: readonly string[],
  now: Date,
  early = false,
): ForecastBlock | null {
  if (!claim.resolvesAt) return "not_a_forecast";
  if (claim.resolution) return "resolved";
  if (!early && claim.resolvesAt.getTime() > now.getTime()) return "not_due";
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

// ── Hilos de pronóstico que concluyen (ADR-0043) ─────────────────────

/** Clave de una respuesta: sin acentos, minúsculas y espacios simples. "Kimi Antonelli" = "kimi  antonelli". */
export function answerKey(answer: string): string {
  return answer
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Una pregunta de sí o no: la respuesta es `yes` o `no`, y resolverse de cualquier forma la responde. */
export function isBinaryAnswer(answer: string): boolean {
  const k = answerKey(answer);
  return k === "yes" || k === "no";
}

/**
 * ¿Responde la pregunta del hilo este pronóstico resuelto? Sí si ocurrió lo pronosticado; en
 * una pregunta de sí o no, también si no ocurrió. `void` nunca la responde.
 */
export function answersQuestion(answer: string | null, outcome: ForecastOutcome | null): boolean {
  if (!answer || !outcome || outcome === "void") return false;
  return outcome === "yes" || isBinaryAnswer(answer);
}

export interface ForecastPoint {
  party: string;
  probability: number;
  at: Date;
}

/** La cifra vigente de cada parte: la última que dio. Ordenadas de la más reciente a la más antigua. */
export function currentPoints<T extends ForecastPoint>(points: readonly T[]): T[] {
  const byParty = new Map<string, T>();
  for (const p of [...points].sort((a, b) => a.at.getTime() - b.at.getTime())) byParty.set(p.party, p);
  // A igual hora, la que llegó después va primero.
  return [...byParty.values()].reverse().sort((a, b) => b.at.getTime() - a.at.getTime());
}

export function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Hay acuerdo sobre una respuesta: bastantes partes con cifra y poca diferencia entre ellas. */
export function hasConsensus(probabilities: readonly number[], minParties: number, maxSpread: number): boolean {
  if (probabilities.length < minParties) return false;
  return Math.max(...probabilities) - Math.min(...probabilities) <= maxSpread + 1e-9;
}

/** La mediana de las cifras vigentes tras cada cifra nueva. */
export function medianHistory(points: readonly ForecastPoint[]): { at: Date; median: number }[] {
  const sorted = [...points].sort((a, b) => a.at.getTime() - b.at.getTime());
  const current = new Map<string, number>();
  return sorted.map((p) => {
    current.set(p.party, p.probability);
    return { at: p.at, median: median([...current.values()]) };
  });
}

/**
 * Brier de una parte ponderado por el tiempo (ADR-0043): cada cifra cuenta el tiempo que estuvo
 * vigente, desde que la dio hasta la siguiente o hasta `end`. Así no se gana nada poniendo
 * muchas cifras al final, cuando ya se sabe el resultado. Con una sola cifra es el Brier de siempre.
 */
export function timeWeightedBrier(
  points: readonly { probability: number; at: Date }[],
  end: Date,
  outcome: ForecastOutcome | null,
): number | null {
  if (!points.length || (outcome !== "yes" && outcome !== "no")) return null;
  const y = outcome === "yes" ? 1 : 0;
  const sorted = [...points].sort((a, b) => a.at.getTime() - b.at.getTime());
  let weighted = 0;
  let total = 0;
  sorted.forEach((p, i) => {
    const until = Math.min(sorted[i + 1]?.at.getTime() ?? end.getTime(), end.getTime());
    const span = Math.max(0, until - p.at.getTime());
    weighted += span * (p.probability - y) ** 2;
    total += span;
  });
  if (total === 0) return (sorted.at(-1)!.probability - y) ** 2;
  return weighted / total;
}

export type UpdateBlock = "not_a_forecast" | "resolved" | "past_due";

/** ¿Se le puede poner una cifra nueva? Solo a un pronóstico abierto y antes de su fecha. */
export function updateBlock(
  claim: { resolvesAt: Date | null; resolution: ForecastOutcome | null },
  now: Date,
): UpdateBlock | null {
  if (!claim.resolvesAt) return "not_a_forecast";
  if (claim.resolution) return "resolved";
  if (claim.resolvesAt.getTime() <= now.getTime()) return "past_due";
  return null;
}
