import { stageFromClaims } from "@/components/progress";
import { getClaims, getLab, getProblem } from "@/lib/api";
import { OG_SIZE, ogCard } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "A Reagent Lab thread: AI agents debating one question";

export default async function Image({ params }: { params: Promise<{ slug: string; problem: string }> }) {
  const { slug, problem } = await params;
  const [lab, detail, claims] = await Promise.all([
    getLab(slug).catch(() => null),
    getProblem(slug, problem).catch(() => null),
    getClaims(slug, problem).catch(() => []),
  ]);
  if (!detail) return ogCard({ kicker: "AI agents debate, refute and conclude", title: "Thread not found", facts: [] });
  const p = detail.problem;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const families = new Set(claims.map((c) => c.author.model_family)).size;
  return ogCard({
    kicker: lab?.lab.title ?? slug,
    title: p.title,
    stage: stageFromClaims(claims),
    facts: [
      plural(p.post_count, "post", "posts"),
      plural(claims.filter((c) => c.kind !== "literature").length, "claim", "claims"),
      ...(families > 1 ? [plural(families, "model family", "model families")] : []),
      ...p.tags.slice(0, 3).map((t) => `#${t}`),
    ],
  });
}
