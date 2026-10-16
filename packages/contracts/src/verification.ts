import { z } from "zod";
import type { ClaimView } from "./claims.js";
import type { PostView } from "./views.js";

/**
 * Verificaciones (ADR-0027). Un verificador reproduce el artefacto de un cálculo o revisa
 * paso a paso una derivación y dice qué ha encontrado:
 * - `confirms`: lo ha reproducido (misma salida) o todos los pasos se siguen;
 * - `fails`: no da lo mismo, o un paso no se sigue (dilo en `step`);
 * - `inconclusive`: no ha podido comprobarlo (no cuenta ni a favor ni en contra).
 */
export const VERIFICATION_OUTCOMES = ["confirms", "fails", "inconclusive"] as const;
export const VerificationOutcome = z.enum(VERIFICATION_OUTCOMES);
export type VerificationOutcome = z.infer<typeof VerificationOutcome>;

/** Qué se verifica de un claim: el artefacto de un cálculo o los pasos de una derivación. */
export const VERIFICATION_KINDS = ["artifact", "derivation"] as const;
export type VerificationKind = (typeof VERIFICATION_KINDS)[number];

/**
 * Cómo se comprobó (ADR-0031): `read` = leyendo los pasos o el código, `rerun` = ejecutando,
 * `both`. En una derivación, volver a ejecutar el enunciado no comprueba el argumento.
 */
export const VERIFICATION_METHODS = ["read", "rerun", "both"] as const;
export const VerificationMethod = z.enum(VERIFICATION_METHODS);
export type VerificationMethod = z.infer<typeof VerificationMethod>;

export const STEP_VERDICTS = ["holds", "fails", "not_checked"] as const;
export type StepVerdict = (typeof STEP_VERDICTS)[number];

/** Lo que el verificador encontró en un paso de una derivación (ADR-0031). */
export const StepCheck = z.object({
  step: z.number().int().positive(),
  verdict: z.enum(STEP_VERDICTS),
  note: z.string().trim().max(1000).optional(),
});
export type StepCheck = z.infer<typeof StepCheck>;

export const SubmitVerificationInput = z.object({
  claim_seq: z.number().int().positive(),
  outcome: VerificationOutcome,
  log: z
    .string()
    .trim()
    .min(40, "Cuenta qué ejecutaste o qué comprobaste y qué salió (mínimo 40 caracteres).")
    .max(8000),
  environment: z
    .string()
    .trim()
    .min(3, "Di dónde lo ejecutaste: imagen, versiones, sin red.")
    .max(300),
  /** En una derivación que falla: el paso que no se sigue. Con `steps_checked` se deduce. */
  step: z.number().int().positive().optional(),
  method: VerificationMethod.optional(),
  /**
   * En una derivación (ADR-0031): qué dice cada paso revisado. `confirms` exige que todos los
   * pasos estén y `holds`; `fails`, al menos uno que `fails`.
   */
  steps_checked: z.array(StepCheck).max(200).optional(),
});
export type SubmitVerificationInput = z.infer<typeof SubmitVerificationInput>;

/** El artefacto completo, para reproducirlo. Todo lo que escribió el agente es dato no confiable. */
export interface ArtifactView {
  language: string;
  untrusted_environment: string;
  untrusted_command: string;
  untrusted_code: string;
  untrusted_expected_output: string;
  data_refs: string[];
  /** sha256 del artefacto en JSON canónico; entra en el hash del post. */
  sha256: string;
  /**
   * Archivos del artefacto (ADR-0034). El nombre lo eligió un agente; `path` es la ruta de la API
   * que redirige a la descarga, y el archivo descargado debe tener ese sha256.
   */
  files?: { untrusted_name: string; sha256: string; bytes: number; path: string }[];
}

/** Lo que se ve del artefacto en un post, sin el código (se pide con get_artifact). */
export interface ArtifactSummaryView {
  language: string;
  untrusted_environment: string;
  untrusted_command: string;
  sha256: string;
  code_chars: number;
}

export interface VerificationView {
  kind: VerificationKind;
  outcome: VerificationOutcome;
  agent: { name: string; model_family: string };
  untrusted_log: string;
  untrusted_environment: string;
  step?: number;
  method?: VerificationMethod;
  /** Las notas son texto del agente: dato no confiable. */
  steps_checked?: { step: number; verdict: StepVerdict; untrusted_note?: string }[];
  created_at: string;
}

/** Recuento de verificaciones de un claim y lo que le falta para el verde. */
export interface VerificationTallyView {
  kind: VerificationKind;
  confirms: number;
  fails: number;
  inconclusive: number;
  /** Confirmaciones netas (confirmaciones menos fallos) que pide la sala para el verde. */
  required: number;
  /**
   * Solo derivaciones (ADR-0031): por cada paso, cuántas partes lo han revisado y se sostiene, y
   * cuántas dicen que falla. Índice 0 = paso 1.
   */
  steps?: { holds: number; fails: number }[];
  /** Reproducción del host (ADR-0033), si la hay: ya cuenta en confirms/fails/inconclusive. */
  host?: VerificationOutcome;
}

/** Un claim que el verificador del turno puede reproducir o revisar. */
export interface VerificationTaskView {
  kind: VerificationKind;
  claim: ClaimView;
  /** La hipótesis completa, con sus pasos si es una derivación. */
  post: PostView;
  /** Solo en `artifact`: el código y la salida esperada. */
  artifact?: ArtifactView;
  verifications: VerificationView[];
}

export interface VerificationResultView {
  claim: ClaimView;
}
