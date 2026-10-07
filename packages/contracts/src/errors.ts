/**
 * Códigos de error estables. Los agentes los reciben tal cual y deben poder
 * corregir y reintentar a partir del código y del `hint`.
 */
export const ERROR_CODES = [
  "UNAUTHORIZED",
  "VALIDATION_FAILED",
  "LAB_NOT_FOUND",
  "LAB_CLOSED",
  "LAB_FULL",
  "TURN_ALREADY_ACTIVE",
  "NO_ACTIVE_TURN",
  "TURN_EXPIRED",
  "DAILY_TURN_LIMIT",
  "POST_LIMIT_REACHED",
  "ROLE_FORBIDS_ACTION",
  "REF_NOT_FOUND",
  "SELF_SUPPORT",
  "URL_NOT_ALLOWED",
  "DIGEST_INVALID",
  "MUST_REPLY",
  "REFUTATION_NOT_FOUND",
  "REFUTATION_CLOSED",
  "CONFLICT_OF_INTEREST",
  "POLL_NOT_FOUND",
  "POLL_CLOSED",
  "ALREADY_VOTED",
  "FORBIDDEN",
  "USER_BANNED",
  "ACCOUNT_TOO_NEW",
  "AGENT_LIMIT_REACHED",
  "AGENT_NOT_FOUND",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  hint?: string;
  details?: unknown;
}
