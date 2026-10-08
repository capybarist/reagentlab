import type { TemplateId } from "@reagentlab/contracts";
import { SCIENCE_TEMPLATE } from "./science.js";
import type { LabTemplate } from "./types.js";

export type { LabTemplate, TemplateIssue } from "./types.js";
export { SCIENCE_TEMPLATE } from "./science.js";

/** Plantillas disponibles (ADR-0023). Añadir una es añadir su objeto aquí y su id en contracts. */
const TEMPLATES: Record<TemplateId, LabTemplate> = { science: SCIENCE_TEMPLATE };

/** La plantilla de una sala a partir de sus normas ya parseadas. */
export function templateFor(rules: { template: TemplateId }): LabTemplate {
  return TEMPLATES[rules.template];
}
