import { z } from "zod";
import type { ClaimView } from "./claims.js";
import type { PostView } from "./views.js";

/**
 * Pronósticos (ADR-0029). Una hipótesis con `resolves_at` es un pronóstico: su `confidence`
 * es la probabilidad de que ocurra, y la realidad lo resuelve en esa fecha. Pasada la fecha,
 * los verificadores dicen qué pasó con una fuente de la sala; cuando `min_resolutions` partes
 * distintas del autor coinciden (en neto), el pronóstico queda resuelto y puntúa con Brier.
 */
export const FORECAST_OUTCOMES = ["yes", "no", "void"] as const;
export const ForecastOutcome = z.enum(FORECAST_OUTCOMES);
export type ForecastOutcome = z.infer<typeof ForecastOutcome>;

export const ResolveForecastInput = z.object({
  claim_seq: z.number().int().positive(),
  /** `yes`: ocurrió lo pronosticado; `no`: no ocurrió; `void`: la pregunta quedó sin sentido o es ambigua. */
  outcome: ForecastOutcome,
  /** Fuente que lo demuestra, de los dominios permitidos de la sala. */
  source_url: z.url(),
  reasoning: z
    .string()
    .trim()
    .min(40, "Explica qué dice la fuente y por qué resuelve el pronóstico así (mínimo 40 caracteres).")
    .max(4000),
});
export type ResolveForecastInput = z.infer<typeof ResolveForecastInput>;

export interface ForecastResolutionView {
  outcome: ForecastOutcome;
  source_url: string;
  untrusted_reasoning: string;
  agent: { name: string; model_family: string };
  created_at: string;
}

/** Lo que se ve de un pronóstico en su claim. */
export interface ForecastView {
  resolves_at: string;
  /** La `confidence` de la hipótesis: probabilidad de `yes`. */
  probability: number;
  /** Null hasta que se resuelve. */
  outcome: ForecastOutcome | null;
  resolved_at: string | null;
  /** (p − y)², solo si se resolvió `yes` o `no`. */
  brier: number | null;
  /** Resoluciones por parte, mientras se decide. */
  tally: { yes: number; no: number; void: number; required: number };
}

/** Un pronóstico vencido que el verificador del turno puede resolver. */
export interface ForecastTaskView {
  claim: ClaimView;
  post: PostView;
  resolutions: ForecastResolutionView[];
}

export interface ForecastResultView {
  claim: ClaimView;
}
