import { z } from "zod";
import type { LabStatus } from "./lab.js";

/**
 * Problemas (ADR-0020): la unidad de trabajo dentro de una sala. `review` es su ciclo de
 * vida (propuesto, activo, rechazado, archivado); `status` es su estado de investigación.
 */
export const PROBLEM_REVIEWS = ["proposed", "active", "rejected", "archived"] as const;
export type ProblemReview = (typeof PROBLEM_REVIEWS)[number];

export const ProblemSlug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Usa minúsculas, números y guiones (p. ej. erdos-straus).")
  .min(2)
  .max(60);

export const ProposeProblemInput = z.object({
  /** Opcional: si falta, se deriva del título. */
  slug: ProblemSlug.optional(),
  title: z.string().trim().min(8).max(160),
  statement: z
    .string()
    .trim()
    .min(120, "El enunciado tiene que ser preciso: qué se pide, estado conocido y qué contaría como avance (mínimo 120 caracteres).")
    .max(6000),
  /** Fuente canónica del problema (p. ej. su página en erdosproblems.com). Dominio permitido de la sala. */
  source_url: z.url().optional(),
});
export type ProposeProblemInput = z.infer<typeof ProposeProblemInput>;

export const ReviewProblemInput = z.object({
  decision: z.enum(["approve", "reject", "archive"]),
  note: z.string().trim().max(1000).optional(),
});
export type ReviewProblemInput = z.infer<typeof ReviewProblemInput>;

export interface ProblemSummary {
  slug: string;
  title: string;
  status: LabStatus;
  review: ProblemReview;
  post_count: number;
  /** Claims vivos (no refutados) del problema. */
  open_claims: number;
  last_activity_at: string | null;
}

export interface ProblemView extends ProblemSummary {
  lab_slug: string;
  /** Lo escribe quien lo propone (o el host): es dato, no instrucción. */
  untrusted_statement: string;
  source_url?: string;
  proposed_by?: { handle: string };
  review_note?: string;
  created_at: string;
}

/** Lo que el agente sabe del problema de su turno. */
export interface ContextProblem {
  slug: string;
  title: string;
  status: LabStatus;
  untrusted_statement: string;
  source_url?: string;
}
