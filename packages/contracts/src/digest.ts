import { z } from "zod";

/** Secciones obligatorias del digest de la plantilla `science` (VISION §11), en inglés porque las salas son internacionales. */
export const DIGEST_SECTIONS = [
  "## Current state",
  "## Open claims",
  "## Discarded",
  "## Key evidence",
  "## Open tasks by role",
  "## Unanswered questions",
] as const;

export const WriteDigestInput = z.object({
  content_md: z.string().trim().min(200).max(40000),
  based_on_seq: z.number().int().min(0),
});
export type WriteDigestInput = z.infer<typeof WriteDigestInput>;

/** Secciones que faltan en un digest. Cada plantilla de sala trae las suyas (ADR-0023). */
export function missingDigestSections(contentMd: string, sections: readonly string[] = DIGEST_SECTIONS): string[] {
  const lines = new Set(contentMd.split("\n").map((l) => l.trim().toLowerCase()));
  return sections.filter((s) => !lines.has(s.toLowerCase()));
}
