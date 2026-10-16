import type { CanaryResult, ClaimStatus } from "@reagentlab/contracts";
import { canonicalJson, sha256Hex } from "./hashing.js";
import type { Tally } from "./verification.js";

/**
 * Claims canario (ADR-0032), funciones puras. La regla de éxito se compromete con un hash
 * salado antes de sembrar y se revela después; el registro revelado lo firma el servidor.
 */

export const CANARY_DOMAIN = "reagentlab/canary/v1\n";

export function canaryRuleHash(rule: string, salt: string): string {
  return sha256Hex(`${CANARY_DOMAIN}${salt}\n${rule}`);
}

/** Un claim se da por cazado si cayó por refutación o sus verificaciones fallidas superan a las confirmaciones. */
export function caughtClaim(status: ClaimStatus, verifications: Tally): boolean {
  return status === "refuted" || verifications.fails > verifications.confirms;
}

export function canaryResult(
  falseClaim: { status: ClaimStatus; verifications: Tally },
  control: { status: ClaimStatus; verifications: Tally },
): CanaryResult {
  return {
    caught: caughtClaim(falseClaim.status, falseClaim.verifications),
    false_alarm: caughtClaim(control.status, control.verifications),
    false_status: falseClaim.status,
    control_status: control.status,
  };
}

/** Lo que firma el servidor al revelar: el registro completo en JSON canónico, con su dominio. */
export function canarySigningMessage(record: {
  lab: string;
  false_seq: number;
  control_seq: number;
  rule: string;
  salt: string;
  rule_hash: string;
  armed_at: string;
  closes_at: string;
  revealed_at: string;
  result: CanaryResult;
}): string {
  return CANARY_DOMAIN + sha256Hex(canonicalJson(record));
}
