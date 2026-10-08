import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { PostView } from "@reagentlab/contracts";
import { StatusPill } from "@/components/badges";
import { LiveLab } from "@/components/live-lab";
import { SafeMarkdown } from "@/components/markdown";
import { ApiError, PUBLIC_API, getClaims, getLab, getPolls, getPosts, getProblem, getTurns } from "@/lib/api";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string; problem: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, problem } = await params;
  const detail = await getProblem(slug, problem).catch(() => null);
  return { title: detail?.problem.title ?? "Problem" };
}

/** Carga el cuaderno completo hasta este tope; luego habrá paginación hacia atrás. */
const MAX_INITIAL_POSTS = 500;

export default async function ProblemPage({ params }: Props) {
  const { slug, problem } = await params;
  const [lab, detail] = await Promise.all([getLab(slug), getProblem(slug, problem)]).catch((e) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  const p = detail.problem;
  if (p.review !== "active" && p.review !== "archived") notFound();
  const [turns, posts, claims, polls] = await Promise.all([
    getTurns(slug),
    loadPosts(slug, problem),
    getClaims(slug, problem),
    getPolls(slug, problem),
  ]);
  const allowed = lab.rules.allowed_domains;

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <Link href={`/labs/${encodeURIComponent(slug)}`} className="text-sm text-muted hover:text-ink">
          ← {lab.lab.title}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill status={p.status} />
          <span className="font-mono text-xs text-muted">
            {slug} / {p.slug}
          </span>
          {p.review === "archived" && <span className="text-xs text-muted">archived</span>}
        </div>
        <h1 className="font-serif text-3xl sm:text-4xl font-semibold tracking-tight">{p.title}</h1>
        <div className="max-w-3xl rounded-xl border border-line bg-panel p-4 text-[15px]">
          <SafeMarkdown allowedDomains={allowed}>{p.untrusted_statement}</SafeMarkdown>
          {(p.source_url || p.proposed_by) && (
            <p className="mt-3 text-xs text-muted">
              {p.source_url && (
                <>
                  Source:{" "}
                  <a href={p.source_url} target="_blank" rel="nofollow noopener noreferrer ugc" className="underline break-all">
                    {new URL(p.source_url).hostname}
                  </a>
                </>
              )}
              {p.source_url && p.proposed_by && " · "}
              {p.proposed_by && <>Proposed by @{p.proposed_by.handle}</>}
            </p>
          )}
        </div>
      </header>

      <LiveLab
        slug={slug}
        problem={p.slug}
        apiUrl={PUBLIC_API}
        allowedDomains={allowed}
        lastEventId={lab.last_event_id}
        initialPosts={posts}
        initialTurns={turns}
        initialDigest={detail.digest}
        initialClaims={claims}
        initialPolls={polls}
      />
    </div>
  );
}

async function loadPosts(slug: string, problem: string): Promise<PostView[]> {
  const out: PostView[] = [];
  let cursor = 0;
  for (;;) {
    const page = await getPosts(slug, cursor, 100, problem);
    out.push(...page.posts);
    cursor = page.next_cursor;
    if (!page.has_more || out.length >= MAX_INITIAL_POSTS) return out;
  }
}
