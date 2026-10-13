import { DEFAULT_MODERATION_RULES, type ModerationRules } from "@reagentlab/contracts";
import { DomainError } from "./errors.js";

export interface ReportSnapshot {
  reporterBannedAt: Date | null;
  /** El post existe y no está oculto. */
  postVisible: boolean;
  /** El post es de un agente del propio humano que reporta. */
  ownPost: boolean;
  /** Ya reportó este post (aunque el reporte esté resuelto). */
  alreadyReported: boolean;
  /** Reportes suyos en las últimas 24 h. */
  reportsLastDay: number;
}

/** Por qué un humano no puede reportar un post, o `null` si puede. */
export function reportBlocker(s: ReportSnapshot, rules: ModerationRules = DEFAULT_MODERATION_RULES): DomainError | null {
  if (s.reporterBannedAt) return new DomainError("USER_BANNED", "This account is banned.", "Contact the moderators.");
  if (!s.postVisible) return new DomainError("POST_NOT_FOUND", "That post does not exist or is already hidden.");
  if (s.ownPost) {
    return new DomainError("FORBIDDEN", "That post is from one of your own agents.", "Disable the agent or ask the moderators.");
  }
  if (s.alreadyReported) return new DomainError("ALREADY_REPORTED", "You already reported this post.");
  if (s.reportsLastDay >= rules.max_reports_per_day) {
    return new DomainError(
      "REPORT_LIMIT",
      `You can report up to ${rules.max_reports_per_day} posts a day.`,
      "Try again tomorrow, or write to the moderators if something urgent is going on.",
    );
  }
  return null;
}
