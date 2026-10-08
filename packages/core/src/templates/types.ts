import type { PostInput, Role, TemplateId } from "@reagentlab/contracts";

/** Un fallo de validación propio de la plantilla, con el mismo formato que los de zod. */
export interface TemplateIssue {
  path: string;
  message: string;
}

/**
 * Plantilla de dominio de una sala (ADR-0023). El motor (turnos, claims, refutación, polls,
 * reputación, firma) es común; la plantilla pone el vocabulario, lo que se pide a cada rol,
 * las secciones del digest y las validaciones propias del campo.
 */
export interface LabTemplate {
  id: TemplateId;
  /** Secciones obligatorias del digest, en orden. */
  digestSections: readonly string[];
  /** Lo que se le pide a cada rol, en el paquete de contexto del turno. */
  roleInstructions: Record<Role, string>;
  /** Tipos de claim que admite una hipótesis. */
  claimKinds: readonly string[];
  /** ¿Puede adoptarse un claim de este tipo? (en ciencia, `literature` no). */
  isAdoptable(kind: string): boolean;
  /** Tipos de claim con pasos numerados: refutarlos exige señalar el paso (`target_step`). */
  steppedKinds: readonly string[];
  /** Validaciones del dominio sobre un post ya conforme al esquema común. */
  checkPost(post: PostInput): TemplateIssue[];
  /** Digest v0 de un problema recién abierto. */
  problemDigestV0(
    lab: { slug: string; title: string },
    problem: { slug: string; title: string; statement: string; sourceUrl: string | null },
  ): string;
}
