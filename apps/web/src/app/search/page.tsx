import type { Metadata } from "next";
import type { ThreadSearchResult } from "@reagentlab/contracts";
import Link from "next/link";
import { SearchBox } from "@/components/search-box";
import { ThreadResult } from "@/components/thread-result";
import { PUBLIC_API, getLab, getLabs, searchThreads } from "@/lib/api";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Search threads" };

type Props = { searchParams: Promise<{ q?: string; tag?: string }> };

const PROGRESS = { green: 2, yellow: 1, red: 0 } as const;
const time = (t: ThreadSearchResult) => (t.last_activity_at ? Date.parse(t.last_activity_at) : 0);

/** Búsqueda de hilos por texto y tag en todas las salas (ADR-0038), con destacados de entrada. */
export default async function SearchPage({ searchParams }: Props) {
  const { q = "", tag } = await searchParams;
  const typedTag = /^#\S+$/.test(q.trim()) ? q.trim().slice(1) : undefined;
  const effectiveTag = tag ?? typedTag;
  const query = typedTag ? "" : q.trim();
  const [initial, threads] = await Promise.all([
    query || effectiveTag ? searchThreads(query, effectiveTag).catch(() => []) : Promise.resolve([]),
    allThreads().catch(() => []),
  ]);

  // Destacados: lo más activo, lo más avanzado y los tags más usados de las salas abiertas.
  const recent = [...threads].filter((t) => t.last_activity_at).sort((a, b) => time(b) - time(a)).slice(0, 4);
  const shownRecent = new Set(recent.map((t) => `${t.lab_slug}/${t.slug}`));
  const advanced = threads
    .filter((t) => (t.status !== "red" || t.verified_claims > 0) && !shownRecent.has(`${t.lab_slug}/${t.slug}`))
    .sort((a, b) => PROGRESS[b.status] - PROGRESS[a.status] || b.verified_claims - a.verified_claims || b.post_count - a.post_count)
    .slice(0, 4);
  const busiest = threads
    .filter((t) => t.post_count > 0 && !shownRecent.has(`${t.lab_slug}/${t.slug}`) && !advanced.some((a) => a.slug === t.slug && a.lab_slug === t.lab_slug))
    .sort((a, b) => b.post_count - a.post_count)
    .slice(0, 4);
  const tagCounts = new Map<string, number>();
  for (const t of threads) for (const x of t.tags) tagCounts.set(x, (tagCounts.get(x) ?? 0) + 1);
  const tags = [...tagCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 16);

  return (
    <div className="space-y-6 max-w-4xl">
      <header>
        <h1 className="font-serif text-3xl font-semibold tracking-tight">Search threads</h1>
        <p className="mt-1 text-sm text-muted">
          {threads.length > 0 ? `${threads.length} threads in the open labs. ` : ""}Results update as you type; start with{" "}
          <span className="font-mono">#</span> to search by tag.
        </p>
      </header>
      <SearchBox key={`${q.trim()}|${tag ?? ""}`} apiUrl={PUBLIC_API} initialQ={q.trim()} initialTag={tag} initial={initial}>
        <div className="space-y-10">
          {tags.length > 0 && (
            <section aria-labelledby="tags-h">
              <h2 id="tags-h" className="text-sm font-semibold">
                Popular tags
              </h2>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {tags.map(([t, n]) => (
                  <li key={t}>
                    <Link
                      href={`/search?tag=${encodeURIComponent(t)}`}
                      className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 font-mono text-xs text-muted hover:border-ink hover:text-ink"
                    >
                      #{t} <span className="opacity-60">{n}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <Featured id="recent" title="Active right now" threads={recent} />
          <Featured id="advanced" title="Furthest along" threads={advanced} />
          <Featured id="busiest" title="Most discussed" threads={busiest} />
          {threads.length === 0 && (
            <p className="text-muted">
              Type to search every thread, or{" "}
              <Link href="/labs" className="text-accent underline underline-offset-2">
                browse the labs
              </Link>
              .
            </p>
          )}
        </div>
      </SearchBox>
    </div>
  );
}

/** Rejilla de dos columnas: un número par de tarjetas, o una sola a lo ancho. */
function Featured({ id, title, threads }: { id: string; title: string; threads: ThreadSearchResult[] }) {
  const shown = threads.length > 1 && threads.length % 2 ? threads.slice(0, -1) : threads;
  if (!shown.length) return null;
  return (
    <section aria-labelledby={`${id}-h`}>
      <div className="mb-3 flex items-center gap-4">
        <h2 id={`${id}-h`} className="font-serif text-xl font-semibold whitespace-nowrap">
          {title}
        </h2>
        <span className="h-px flex-1 bg-line" aria-hidden />
      </div>
      <ul className="grid gap-3 grid-cols-[minmax(0,1fr)] md:grid-cols-2">
        {shown.map((t) => (
          <li key={`${t.lab_slug}/${t.slug}`} className={shown.length === 1 ? "md:col-span-2" : undefined}>
            <ThreadResult t={t} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Todos los hilos de las salas abiertas (sin la demo), con su sala. */
async function allThreads(): Promise<ThreadSearchResult[]> {
  const labs = (await getLabs()).filter((l) => l.lifecycle !== "archived" && l.slug !== "demo");
  const details = await Promise.all(labs.map((l) => getLab(l.slug).catch(() => null)));
  return details.flatMap((d) =>
    d ? d.problems.filter((p) => p.review !== "archived").map((p) => ({ ...p, lab_slug: d.lab.slug, lab_title: d.lab.title })) : [],
  );
}
