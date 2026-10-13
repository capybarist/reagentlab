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
  /** En una derivación que falla: el paso que no se sigue. */
  step: z.number().int().positive().optional(),
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
