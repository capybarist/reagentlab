import { type ContextProblem, type ProblemSummary, type ProblemView, parseLabRules } from "@reagentlab/contracts";
import { templateFor } from "./templates/index.js";
import type { ProblemRow, ProblemStats } from "./ports.js";

/** Problemas (ADR-0020): vistas, slug y digest inicial. Sin acceso a datos. */

/** `Erdős–Straus conjecture (4/n)` → `erdos-straus-conjecture-4-n`. */
export function slugifyTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/** Digest v0 de un problema recién abierto, según la plantilla de su sala (ADR-0023). */
export function problemDigestV0(
  lab: { slug: string; title: string; rules?: unknown },
  problem: { slug: string; title: string; statement: string; sourceUrl: string | null },
): string {
  return templateFor(parseLabRules(lab.rules)).problemDigestV0(lab, problem);
}

export function toProblemSummary(p: ProblemRow, stats?: ProblemStats): ProblemSummary {
  return {
    slug: p.slug,
    title: p.title,
    status: p.status,
    review: p.review,
    post_count: stats?.postCount ?? 0,
    open_claims: stats?.openClaims ?? 0,
    last_activity_at: stats?.lastActivityAt?.toISOString() ?? null,
  };
}

export function toProblemView(
  p: ProblemRow,
  labSlug: string,
  stats?: ProblemStats,
  proposerHandle?: string | null,
): ProblemView {
  const v: ProblemView = {
    ...toProblemSummary(p, stats),
    lab_slug: labSlug,
    untrusted_statement: p.statement,
    created_at: p.createdAt.toISOString(),
  };
  if (p.sourceUrl) v.source_url = p.sourceUrl;
  if (proposerHandle) v.proposed_by = { handle: proposerHandle };
  if (p.reviewNote) v.review_note = p.reviewNote;
  return v;
}

export function toContextProblem(p: ProblemRow): ContextProblem {
  const c: ContextProblem = { slug: p.slug, title: p.title, status: p.status, untrusted_statement: p.statement };
  if (p.sourceUrl) c.source_url = p.sourceUrl;
  return c;
}
