import { z } from "zod";
import type { Role } from "./lab.js";

export const POST_TYPES = ["hypothesis", "evidence", "refutation", "question", "meta"] as const;
export const PostType = z.enum(POST_TYPES);
export type PostType = z.infer<typeof PostType>;

export const Body = z
  .string()
  .trim()
  .min(40, "El cuerpo es demasiado corto para aportar algo nuevo (mínimo 40 caracteres).")
  .max(8000);
export const Confidence = z.number().min(0).max(1);
/** Referencias a posts anteriores de la misma sala, por su número de secuencia. */
export const Refs = z.array(z.number().int().positive()).max(20).default([]);

export const Evidence = z.object({
  kind: z.enum(["url", "computation", "citation", "data"]),
  description: z.string().trim().min(20).max(2000),
  url: z.url().optional(),
});
export type Evidence = z.infer<typeof Evidence>;

const Statement = z.string().trim().min(10).max(1000);

/**
 * Qué aporta una hipótesis (ADR-0019). Solo lo propio (`derivation`, `computation`,
 * `conjecture`) puede adoptarse; `literature` va al registro de resultados conocidos.
 */
export const CLAIM_KINDS = ["derivation", "computation", "conjecture", "literature"] as const;
export const ClaimKind = z.enum(CLAIM_KINDS, {
  message:
    "claim_kind es obligatorio: derivation (tu argumento, en steps), computation (tu cálculo, con evidencia de tipo computation), " +
    "conjecture (idea nueva sin argumento aún) o literature (resultado ya publicado, con su cita).",
});
export type ClaimKind = z.infer<typeof ClaimKind>;

/** Un paso de una derivación: una afirmación que un refutador pueda señalar por su número. */
const Step = z.string().trim().min(10).max(2000);

export const HypothesisInput = z.object({
  type: z.literal("hypothesis"),
  body: Body,
  refs: Refs,
  confidence: Confidence,
  claim_kind: ClaimKind,
  /** Pasos numerados del argumento propio (obligatorios en `derivation`). */
  steps: z.array(Step).max(30).default([]),
  /** Evidencia de la propia hipótesis: el cálculo (`computation`) o la cita (`literature`). */
  evidence: z.array(Evidence).max(10).default([]),
  predictions: z.array(Statement).min(1, "Una hipótesis necesita al menos una predicción comprobable."),
  falsifiers: z.array(Statement).min(1, "Una hipótesis necesita al menos un falsador: qué la invalidaría."),
});

export const EvidenceInput = z.object({
  type: z.literal("evidence"),
  body: Body,
  refs: z.array(z.number().int().positive()).min(1, "La evidencia tiene que referirse a algún post.").max(20),
  confidence: Confidence,
  evidence: z.array(Evidence).min(1, "No se apoya nada sin evidencia nueva."),
});

export const RefutationInput = z.object({
  type: z.literal("refutation"),
  body: Body,
  refs: Refs,
  target_seq: z.number().int().positive(),
  /** Paso de la derivación que falla. Obligatorio si el objetivo es una `derivation` (ADR-0019). */
  target_step: z.number().int().positive().optional(),
  confidence: Confidence,
  evidence: z.array(Evidence).min(1, "Una refutación tiene que aportar evidencia."),
});

export const QuestionInput = z.object({
  type: z.literal("question"),
  body: Body,
  refs: Refs,
});

export const MetaInput = z.object({
  type: z.literal("meta"),
  body: Body,
  refs: Refs,
});

/**
 * Forma común de un post. Lo propio de cada campo (p. ej. que una `derivation` traiga pasos)
 * lo comprueba la plantilla de la sala (ADR-0023), en `LabService.post`.
 */
export const PostInput = z.discriminatedUnion("type", [HypothesisInput, EvidenceInput, RefutationInput, QuestionInput, MetaInput]);
export type PostInput = z.infer<typeof PostInput>;

/** Qué tipos de post puede publicar cada rol. */
export const ROLE_POST_TYPES: Record<Role, readonly PostType[]> = {
  proposer: ["hypothesis", "evidence", "refutation", "question", "meta"],
  refuter: ["refutation", "evidence", "question"],
  verifier: ["evidence", "refutation", "question"],
  scribe: ["meta", "question"],
};
