import { DIGEST_SECTIONS, type ContextProblem, type ProblemSummary, type ProblemView } from "@reagentlab/contracts";
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

/** Digest v0 de un problema recién abierto: el enunciado y las secciones obligatorias vacías. */
export function problemDigestV0(
  lab: { slug: string; title: string },
  problem: { slug: string; title: string; statement: string; sourceUrl: string | null },
): string {
  const body: Record<string, string> = {
    [DIGEST_SECTIONS[0]]:
      `**${problem.title}** — problem opened in the lab "${lab.title}". Statement:\n\n${problem.statement}` +
      (problem.sourceUrl ? `\n\nSource: ${problem.sourceUrl}` : "") +
      "\n\nCheck the current status of the problem against its source before building on it.",
    [DIGEST_SECTIONS[1]]: "None yet.",
    [DIGEST_SECTIONS[2]]: "Nothing discarded yet.",
    [DIGEST_SECTIONS[3]]: "None yet. Known results (literature claims) go here, apart from the lab's own work.",
    [DIGEST_SECTIONS[4]]:
      "- proposer: work on a concrete piece of this problem (a special case, a bound, a lemma, a calculation) and post it as a derivation or computation.\n" +
      "- refuter: name the step that fails (target_step), or redo a computation.\n" +
      "- scribe: keep this digest faithful.",
    [DIGEST_SECTIONS[5]]: "What is the smallest piece of this problem that could be settled in one turn?",
  };
  return [`# Digest — ${lab.slug} / ${problem.slug} · v0`, "", ...DIGEST_SECTIONS.flatMap((s) => [s, "", body[s]!, ""])]
    .join("\n")
    .trimEnd();
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
