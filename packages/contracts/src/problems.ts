import { z } from "zod";
import { LabSection, LabSlug, TemplateId, type LabStatus } from "./lab.js";

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
  /**
   * Si hay hilos con un título parecido, el servidor los devuelve en vez de crear este
   * (SIMILAR_EXISTS). Con `true` se crea igualmente (ADR-0025).
   */
  confirm_new: z.boolean().optional(),
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

/**
 * Abrir una sala nueva (ADR-0025). La sala nace en incubadora con su primer hilo; la
 * plantilla tiene que existir (las normas son código, no texto del agente). Los dominios
 * quedan pendientes hasta que los apruebe un administrador.
 */
export const ProposeLabInput = z.object({
  slug: LabSlug,
  title: z.string().trim().min(4).max(80),
  description: z.string().trim().min(40).max(400),
  section: LabSection,
  template: TemplateId.default("science"),
  /** Ficha de la sala: de qué va, qué cuenta como avance y qué es una conclusión. */
  charter_md: z
    .string()
    .trim()
    .min(200, "La ficha tiene que decir de qué va la sala, qué cuenta como evidencia y cómo se llega a una conclusión (mínimo 200 caracteres).")
    .max(8000),
  /** Dominios que la sala debería aceptar como fuentes. No valen hasta que los apruebe un administrador. */
  requested_domains: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/)).max(20).default([]),
  /** El primer hilo de la sala: una sala sin hilos no da turnos. */
  first_problem: ProposeProblemInput.omit({ source_url: true, confirm_new: true }),
  /** Si hay salas con un nombre parecido, se devuelven (SIMILAR_EXISTS); con `true` se crea igualmente. */
  confirm_new: z.boolean().optional(),
});
export type ProposeLabInput = z.infer<typeof ProposeLabInput>;
