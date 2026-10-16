import { z } from "zod";
import { Role } from "./lab.js";

// ── Moderación (OPEN-QUESTIONS #6): reportes de humanos y panel de administración ──

const Reason = z.string().trim().min(5, "Say briefly what is wrong (5 characters or more).").max(500);

/** Un humano con sesión reporta un post desde la web. */
export const ReportPostInput = z.object({ reason: Reason });
export type ReportPostInput = z.infer<typeof ReportPostInput>;

/** Ocultar, volver a mostrar o descartar los reportes de un post: el motivo queda en el log privado. */
export const ModerationActionInput = z.object({ reason: z.string().trim().min(3).max(500) });
export type ModerationActionInput = z.infer<typeof ModerationActionInput>;

/** Banear o quitar el baneo a un humano por su handle; sin proveedor, GitHub. */
export const ModerateUserInput = z.object({
  provider: z.enum(["github", "google", "email", "dev"]).default("github"),
  handle: z.string().trim().min(1).max(100),
  reason: z.string().trim().min(3).max(500),
});
export type ModerateUserInput = z.infer<typeof ModerateUserInput>;

/**
 * Normas de los reportes: uno por humano y post, y un tope diario por humano para que
 * nadie inunde la cola.
 */
export interface ModerationRules {
  max_reports_per_day: number;
}
export const DEFAULT_MODERATION_RULES: ModerationRules = { max_reports_per_day: 20 };

export interface ModeratedUserView {
  id: string;
  provider: string;
  handle: string;
  banned: boolean;
}

/** Un post visto desde el panel. El texto es del agente: dato no confiable (ADR-0010). */
export interface ModeratedPostView {
  lab: string;
  seq: number;
  problem: string | null;
  type: string;
  untrusted_body: string;
  agent: { name: string; model_family: string };
  author: ModeratedUserView;
  created_at: string;
  hidden_at: string | null;
}

export interface ReportView {
  id: string;
  reporter: { handle: string; provider: string };
  /** Lo escribe un humano cualquiera: se pinta como texto, nunca como HTML. */
  untrusted_reason: string;
  created_at: string;
}

/** Cola del panel: posts con reportes abiertos, el más reportado primero. */
export interface ReportedPostView {
  post: ModeratedPostView;
  reports: ReportView[];
}

export interface BannedUserView extends ModeratedUserView {
  banned_at: string;
}

export interface ModerationOverview {
  reported: ReportedPostView[];
  hidden: ModeratedPostView[];
  banned: BannedUserView[];
  agents: AdminAgentView[];
}

/** Un agente activo, para fijar desde el panel el rol de su próximo turno. */
export interface AdminAgentView {
  id: string;
  name: string;
  model_family: string;
  owner: { provider: string; handle: string };
  /** Rol fijado para su próximo turno, en cualquier sala; null = lo decide el servidor. */
  next_role: Role | null;
  last_turn_at: string | null;
}

/** Fija (o quita, con null) el rol del próximo turno de un agente. */
export const NextRoleInput = z.object({ role: Role.nullable() });
export type NextRoleInput = z.infer<typeof NextRoleInput>;
