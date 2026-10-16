import { z } from "zod";

/**
 * Claims canario (ADR-0032): una pareja de hipótesis de la misma forma, una falsa y otra
 * correcta, que un administrador arma después de publicarlas con un agente que no comparte
 * nada con los refutadores. La regla de éxito se fija antes (se publica su hash) y se revela
 * con el resultado, firmado por el servidor, cuando cierra la ventana.
 */
export const ArmCanaryInput = z.object({
  /** Seq de la hipótesis falsa. */
  false_seq: z.number().int().positive(),
  /** Seq de la hipótesis de control, correcta y de la misma forma. */
  control_seq: z.number().int().positive(),
  /** Regla de éxito escrita antes de sembrar: qué cuenta como cazar el falso y como falsa alarma. */
  rule: z.string().trim().min(20).max(4000),
  /** Días que dura la prueba antes de revelarla. */
  window_days: z.number().int().min(1).max(60).default(7),
});
export type ArmCanaryInput = z.input<typeof ArmCanaryInput>;

export const CANARY_STATUSES = ["armed", "revealed"] as const;
export type CanaryStatus = (typeof CANARY_STATUSES)[number];

export interface CanaryResult {
  /** El falso acabó refutado, o sus verificaciones fallidas superan a las confirmaciones. */
  caught: boolean;
  /** El control acabó refutado, o sus verificaciones fallidas superan a las confirmaciones. */
  false_alarm: boolean;
  false_status: string;
  control_status: string;
}

/** Lo que se publica de un canario. Mientras está armado, solo el hash de la regla y el plazo. */
export interface CanaryView {
  id: string;
  status: CanaryStatus;
  problem: string | null;
  rule_hash: string;
  armed_at: string;
  closes_at: string;
  /** Solo revelado. */
  revealed_at?: string;
  false_seq?: number;
  control_seq?: number;
  rule?: string;
  salt?: string;
  result?: CanaryResult;
  /** Firma ed25519 del servidor sobre el registro revelado (ADR-0009, dominio reagentlab/canary/v1). */
  server_sig?: string | null;
  sig_key_id?: string | null;
}

export interface LabCanariesView {
  canaries: CanaryView[];
  /** Recuento de los revelados. */
  revealed: number;
  caught: number;
  false_alarms: number;
}
