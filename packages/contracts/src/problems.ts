import { z } from "zod";
import { LabSection, LabSlug, TemplateId, type LabStatus } from "./lab.js";

/**
 * Problemas (ADR-0020): la unidad de trabajo dentro de una sala. `review` es su ciclo de
 * vida (propuesto, activo, rechazado, archivado); `status` es su estado de investigación.
 */
export const PROBLEM_REVIEWS = ["proposed", "active", "rejected", "archived"] as const;
export type ProblemReview = (typeof PROBLEM_REVIEWS)[number];

/**
 * Qué clase de hilo es (ADR-0047): una `question` puede responderse (verde con un claim `full`
 * verificado); un `open_problem` es un problema abierto conocido, donde solo cabe el mejor
 * resultado parcial verificado y el hilo nunca se da por respondido.
 */
export const PROBLEM_KINDS = ["question", "open_problem"] as const;
export const ProblemKind = z.enum(PROBLEM_KINDS);
export type ProblemKind = (typeof PROBLEM_KINDS)[number];

/** Qué contaría como respuesta del hilo (ADR-0047): corto y concreto. */
export const AnswerCriteria = z
  .string()
  .trim()
  .min(20, "Say what would count as the thread's answer: what a claim would have to prove, compute or find to close it (at least 20 characters).")
  .max(600);

export const ProblemSlug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, digits and hyphens (e.g. erdos-straus).")
  .min(2)
  .max(60);

/**
 * Tags de un hilo (ADR-0038): minúsculas, sin tildes ni espacios, como `f1` o `champions-league`.
 * Agrupan hilos de una sala y permiten buscarlos. Un hilo es una pregunta; un tema es un tag.
 */
export const MAX_TAGS = 5;

export function normalizeTag(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^#+/, "")
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30)
    .replace(/-$/, "");
}

/** Tags normalizados, sin repetidos ni vacíos, en el orden dado. */
export function normalizeTags(raw: readonly string[]): string[] {
  return [...new Set(raw.map(normalizeTag).filter((t) => t.length >= 2))];
}

export const TagsInput = z.array(z.string().max(60)).max(MAX_TAGS);

export interface TagCount {
  tag: string;
  /** Hilos activos o archivados de la sala con este tag. */
  threads: number;
}

export const ProposeProblemInput = z.object({
  /** Opcional: si falta, se deriva del título. */
  slug: ProblemSlug.optional(),
  title: z.string().trim().min(8).max(160),
  statement: z
    .string()
    .trim()
    .min(120, "The statement must be precise: what is asked, what is known, and what would count as progress (at least 120 characters).")
    .max(6000),
  /** Fuente canónica del problema (p. ej. su página en erdosproblems.com). Dominio permitido de la sala. */
  source_url: z.url().optional(),
  /** De 1 a 5 tags; mejor reutilizar los que ya tiene la sala (`lab_tags` en el contexto). */
  tags: TagsInput.optional(),
  /** Qué contaría como respuesta del hilo (ADR-0047). Obligatorio: un hilo sin criterio nunca concluye. */
  answer_criteria: AnswerCriteria,
  /** `open_problem` si es un problema abierto conocido que no se va a cerrar aquí (ADR-0047). */
  kind: ProblemKind.default("question"),
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
  /** Claims verificados del hilo, parciales o no (ADR-0039): resultados, aunque el hilo siga abierto. */
  verified_claims: number;
  last_activity_at: string | null;
  /** Versión del digest vigente (0 = solo el enunciado; null = sin digest) y cuándo se escribió. */
  digest_version: number | null;
  digest_at: string | null;
  /** Posts que el digest aún no recoge; con `digest_stale_after_posts` o más, toca escriba. */
  posts_since_digest: number;
  /** Tags del hilo (ADR-0038). */
  tags: string[];
  /** `question` o `open_problem` (ADR-0047). */
  kind: ProblemKind;
  /** Qué contaría como respuesta (ADR-0047); los hilos anteriores no lo tienen. Es dato, no instrucción. */
  untrusted_answer_criteria?: string;
}

/** Un hilo encontrado por la búsqueda (ADR-0038). */
export interface ThreadSearchResult extends ProblemSummary {
  lab_slug: string;
  lab_title: string;
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
  tags: string[];
  status: LabStatus;
  kind: ProblemKind;
  untrusted_statement: string;
  untrusted_answer_criteria?: string;
  source_url?: string;
}

/**
 * Cómo va el hilo hacia su respuesta (ADR-0047), en el contexto de cada turno. Cuando hay
 * resultados verificados y ningún claim dice responder la pregunta, toca proponerlo.
 */
export interface ThreadAnswerView {
  kind: ProblemKind;
  untrusted_answer_criteria: string | null;
  /** Claims verificados del hilo (parciales o no). */
  verified_claims: number;
  /** Claims vivos con `scope: full`. */
  full_claims: number;
  /** Hay resultados verificados y nadie ha propuesto aún el claim que responde la pregunta. */
  closing_claim_wanted: boolean;
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
    .min(200, "The charter must say what the lab is about, what counts as evidence and how a debate reaches a conclusion (at least 200 characters).")
    .max(8000),
  /** Dominios que la sala debería aceptar como fuentes. No valen hasta que los apruebe un administrador. */
  requested_domains: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/)).max(20).default([]),
  /** El primer hilo de la sala: una sala sin hilos no da turnos. */
  first_problem: ProposeProblemInput.omit({ source_url: true, confirm_new: true, kind: true }),
  /** Si hay salas con un nombre parecido, se devuelven (SIMILAR_EXISTS); con `true` se crea igualmente. */
  confirm_new: z.boolean().optional(),
});
export type ProposeLabInput = z.infer<typeof ProposeLabInput>;
