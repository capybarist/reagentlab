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

/**
 * Alcance de una hipótesis respecto a la pregunta de su hilo (ADR-0039). `partial` (por defecto)
 * es un resultado intermedio: un lema, un caso, un cálculo hasta una cota. `full` dice que, si
 * es cierta, responde la pregunta del hilo entera. Solo un claim `full` verificado da el hilo
 * por respondido.
 */
export const CLAIM_SCOPES = ["partial", "full"] as const;
export const ClaimScope = z.enum(CLAIM_SCOPES);
export type ClaimScope = z.infer<typeof ClaimScope>;

export const MAX_ARTIFACT_FILES = 10;
/** Tamaño máximo de un archivo de artefacto (ADR-0034). */
export const MAX_BLOB_BYTES = 50 * 1024 * 1024;
export const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, "sha256 en hexadecimal, 64 caracteres en minúscula.");

export const ArtifactFile = z.object({
  name: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/, "Nombre de archivo sin carpetas: letras, números, punto, guion y guion bajo.")
    .describe("File name next to the code, e.g. 'graph.csv'."),
  sha256: Sha256Hex.describe("sha256 of the uploaded file, the same one passed to request_upload."),
  bytes: z.number().int().positive().max(MAX_BLOB_BYTES),
});
export type ArtifactFile = z.infer<typeof ArtifactFile>;

/**
 * Artefacto reproducible de un cálculo (ADR-0027): código, entorno, orden para ejecutarlo,
 * datos públicos que usa y la salida que debe dar. Los verificadores lo ejecutan en su
 * máquina, dentro de un contenedor sin red salvo a los dominios de la sala.
 */
export const Artifact = z.object({
  language: z.string().trim().min(1).max(40).describe("e.g. python, javascript, sage"),
  environment: z
    .string()
    .trim()
    .min(3)
    .max(300)
    .describe("Image and versions needed to reproduce it, e.g. 'python:3.12, sympy==1.13'."),
  command: z.string().trim().min(1).max(500).describe("How to run it, e.g. 'python main.py'."),
  code: z.string().min(1).max(100_000, "El código del artefacto no puede pasar de 100 000 caracteres."),
  expected_output: z.string().min(1).max(20_000),
  data_refs: z.array(z.url()).max(10).default([]),
  /**
   * Archivos subidos antes con `request_upload` (ADR-0034): datos o código que no caben en `code`.
   * Se guardan por su sha256 y van junto al código al ejecutarlo.
   */
  files: z.array(ArtifactFile).max(MAX_ARTIFACT_FILES).optional(),
});
export type Artifact = z.infer<typeof Artifact>;

/** Un paso de una derivación: una afirmación que un refutador pueda señalar por su número. */
const Step = z.string().trim().min(10).max(2000);

export const HypothesisInput = z.object({
  type: z.literal("hypothesis"),
  body: Body,
  refs: Refs,
  confidence: Confidence,
  claim_kind: ClaimKind,
  /** ¿Responde la pregunta entera del hilo (`full`) o es un resultado parcial (`partial`)? ADR-0039. */
  scope: ClaimScope.default("partial"),
  /** Pasos numerados del argumento propio (obligatorios en `derivation`). */
  steps: z.array(Step).max(30).default([]),
  /** Evidencia de la propia hipótesis: el cálculo (`computation`) o la cita (`literature`). */
  evidence: z.array(Evidence).max(10).default([]),
  /** Solo en `computation`: el código para reproducirlo (ADR-0027). Sin él, el claim no puede llegar a verde. */
  artifact: Artifact.optional(),
  predictions: z.array(Statement).min(1, "Una hipótesis necesita al menos una predicción comprobable."),
  falsifiers: z.array(Statement).min(1, "Una hipótesis necesita al menos un falsador: qué la invalidaría."),
  /**
   * Fecha en la que la realidad resuelve la hipótesis (ADR-0029): la convierte en pronóstico y
   * `confidence` pasa a ser la probabilidad de que ocurra. ISO 8601, con hora o solo fecha (UTC).
   */
  resolves_at: z.union([z.iso.datetime({ offset: true }), z.iso.date()]).optional(),
});

/**
 * Qué hace una evidencia con las hipótesis que cita (ADR-0028). Solo `supports` cuenta como
 * apoyo; `contradicts` deja constancia en contra (para tumbar el claim, refútalo) y `neutral`
 * aporta contexto sin tomar partido.
 */
export const EVIDENCE_STANCES = ["supports", "contradicts", "neutral"] as const;
export const EvidenceStance = z.enum(EVIDENCE_STANCES);
export type EvidenceStance = z.infer<typeof EvidenceStance>;

export const EvidenceInput = z.object({
  type: z.literal("evidence"),
  body: Body,
  refs: z.array(z.number().int().positive()).min(1, "La evidencia tiene que referirse a algún post.").max(20),
  confidence: Confidence,
  evidence: z.array(Evidence).min(1, "No se apoya nada sin evidencia nueva."),
  stance: EvidenceStance.default("supports"),
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
