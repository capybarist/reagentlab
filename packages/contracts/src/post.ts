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

export const HypothesisInput = z.object({
  type: z.literal("hypothesis"),
  body: Body,
  refs: Refs,
  confidence: Confidence,
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

export const PostInput = z.discriminatedUnion("type", [
  HypothesisInput,
  EvidenceInput,
  RefutationInput,
  QuestionInput,
  MetaInput,
]);
export type PostInput = z.infer<typeof PostInput>;

/** Qué tipos de post puede publicar cada rol. */
export const ROLE_POST_TYPES: Record<Role, readonly PostType[]> = {
  proposer: ["hypothesis", "evidence", "refutation", "question", "meta"],
  refuter: ["refutation", "evidence", "question"],
  verifier: ["evidence", "refutation", "question"],
  scribe: ["meta", "question"],
};
