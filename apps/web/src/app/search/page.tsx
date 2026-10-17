import type { Metadata } from "next";
import Link from "next/link";
import { StatusPill } from "@/components/badges";
import { TagRow } from "@/components/tags";
import { RelativeTime } from "@/components/time";
import { searchThreads } from "@/lib/api";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Search threads" };

type Props = { searchParams: Promise<{ q?: string; tag?: string }> };

/** Búsqueda de hilos por texto y tag en todas las salas (ADR-0038). */
export default async function SearchPage({ searchParams }: Props) {
  const { q = "", tag: tagParam } = await searchParams;
  // "#f1" en la caja busca por tag; el servidor normaliza el tag.
  const typedTag = /^#\S+$/.test(q.trim()) ? q.trim().slice(1) : undefined;
  const tag = tagParam ?? typedTag;
  const query = typedTag ? "" : q.trim();
  const threads = query || tag ? await searchThreads(query, tag).catch(() => []) : [];

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="font-serif text-3xl font-semibold tracking-tight">Search threads</h1>
      <form action="/search" className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q.trim()}
          placeholder="Title, question or #tag"
          className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-3 py-2 text-sm focus:border-ink focus:outline-none"
          aria-label="Search threads"
        />
        {tag && <input type="hidden" name="tag" value={tag} />}
        <button className="rounded-lg border border-ink bg-ink px-4 py-2 text-sm text-paper">Search</button>
      </form>
      {tag && (
        <p className="text-sm text-muted">
          Only threads tagged <span className="font-mono">#{tag}</span> ·{" "}
          <Link href={query ? `/search?q=${encodeURIComponent(query)}` : "/search"} className="underline hover:text-ink">
            remove
          </Link>
        </p>
      )}
      {(query || tag) &&
        (threads.length === 0 ? (
          <p className="text-muted">No threads found.</p>
        ) : (
          <ul className="space-y-3">
            {threads.map((t) => (
              <li key={`${t.lab_slug}/${t.slug}`} className="rounded-xl border border-line bg-panel p-4 space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <StatusPill status={t.status} />
                  <Link href={`/labs/${encodeURIComponent(t.lab_slug)}`} className="hover:text-ink">
                    {t.lab_title}
                  </Link>
                  {t.review === "archived" && <span>· archived</span>}
                </div>
                <Link
                  href={`/labs/${encodeURIComponent(t.lab_slug)}/problems/${encodeURIComponent(t.slug)}`}
                  className="block font-semibold leading-snug hover:underline"
                >
                  {t.title}
                </Link>
                <TagRow tags={t.tags} hrefFor={(x) => `/search?tag=${encodeURIComponent(x)}`} />
                <p className="text-xs text-muted">
                  {t.post_count} post{t.post_count === 1 ? "" : "s"} · {t.open_claims} open claim
                  {t.open_claims === 1 ? "" : "s"}
                  {t.last_activity_at && (
                    <>
                      {" "}
                      · active <RelativeTime iso={t.last_activity_at} />
                    </>
                  )}
                </p>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
