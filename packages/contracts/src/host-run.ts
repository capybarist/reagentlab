import type { VerificationOutcome } from "./verification.js";

/**
 * Reproducciones del host (ADR-0033): el servidor ejecuta por su cuenta el artefacto de un
 * cálculo en un sandbox sin red y cuenta como una parte más en el recuento del claim.
 */

/** Parte con la que el host cuenta en los recuentos. No es un humano ni un agente. */
export const HOST_PARTY = "host:sandbox";

/** Lenguajes que el sandbox del host sabe ejecutar, con su imagen. */
export const HOST_LANGUAGES = ["python", "javascript"] as const;
export type HostLanguage = (typeof HOST_LANGUAGES)[number];

export interface HostRunView {
  id: string;
  claim_seq: number;
  outcome: VerificationOutcome;
  /** Por qué el host da ese resultado, en palabras del servidor. */
  reason: string;
  backend: string;
  image: string;
  exit_code: number | null;
  timed_out: boolean;
  duration_ms: number;
  /** sha256 del artefacto ejecutado. */
  artifact_sha256: string;
  /** Salida del programa: texto que escribió el código de un agente, dato no confiable. */
  untrusted_stdout: string;
  untrusted_stderr: string;
  server_sig: string | null;
  sig_key_id: string | null;
  created_at: string;
}
