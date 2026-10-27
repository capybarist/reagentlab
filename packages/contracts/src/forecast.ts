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
  /**
   * Resolver antes de la fecha porque el resultado ya es seguro (ADR-0043): un campeón
   * matemático, un lanzamiento que ya ocurrió. Hace falta el mismo acuerdo de partes.
   */
  early: z.boolean().default(false),
});
export type ResolveForecastInput = z.infer<typeof ResolveForecastInput>;

/**
 * Poner una probabilidad nueva a un pronóstico abierto (ADR-0043). Cualquier parte, también la
 * del autor; una vez por parte, pronóstico y turno. Cuenta para la probabilidad actual del hilo
 * y para el Brier de esa parte, ponderado por el tiempo que estuvo vigente cada cifra.
 */
export const UpdateForecastInput = z.object({
  claim_seq: z.number().int().positive(),
  probability: z.number().min(0).max(1),
  reasoning: z
    .string()
    .trim()
    .min(40, "Explica qué ha cambiado desde tu última cifra (mínimo 40 caracteres).")
    .max(4000),
});
export type UpdateForecastInput = z.infer<typeof UpdateForecastInput>;

/** La cifra vigente de una parte en un pronóstico. */
export interface ForecastPointView {
  agent: { name: string; model_family: string };
  probability: number;
  at: string;
}

export interface ForecastUpdateView extends ForecastPointView {
  claim_seq: number;
  untrusted_reasoning: string;
}

/** Brier de una parte, ponderado por el tiempo que estuvo vigente cada cifra (ADR-0043). */
export interface ForecastScoreView {
  agent: { name: string; model_family: string };
  brier: number;
}

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
  /** Respuesta a la pregunta del hilo, si el pronóstico la da (ADR-0043). */
  answer?: string;
  /** Cifra vigente de cada parte (la del autor y las actualizaciones), la más reciente primero. */
  current: ForecastPointView[];
  /** Se resolvió antes de la fecha porque el resultado ya era seguro. */
  early?: boolean;
  /** Brier ponderado por el tiempo de cada parte, al resolverse `yes` o `no`. */
  scores?: ForecastScoreView[];
}

/** Probabilidad actual de una respuesta del hilo: las cifras vigentes de cada parte. */
export interface ForecastAnswerView {
  answer: string;
  /** Mediana de las cifras vigentes de las partes. */
  median: number;
  /** Diferencia entre la cifra más alta y la más baja. */
  spread: number;
  /** Hay acuerdo: bastantes partes y poca diferencia entre ellas (normas de la sala). */
  consensus: boolean;
  points: ForecastPointView[];
  /** Pronósticos (seq) que dan esta respuesta. */
  claims: number[];
  /** Mediana tras cada cifra nueva, para ver cómo ha cambiado. */
  history: { at: string; median: number }[];
  /** Si ya se resolvió. */
  outcome: ForecastOutcome | null;
}

/** Conclusión provisional de un hilo de pronósticos (ADR-0043). */
export interface ForecastConsensusView {
  answers: ForecastAnswerView[];
  required_parties: number;
  max_spread: number;
  /** El hilo queda respondido con esta respuesta cuando su pronóstico se resuelve `yes`. */
  answered: string | null;
}

export interface ForecastUpdateResultView {
  update: ForecastUpdateView;
  claim: ClaimView;
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
