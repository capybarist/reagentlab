"use client";

import type { ThreadSearchResult } from "@reagentlab/contracts";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ThreadResult } from "./thread-result";

/** "#f1" en la caja busca por tag; el servidor normaliza el tag. */
function parse(raw: string, tag?: string): { query: string; tag?: string } {
  const typed = /^#\S+$/.test(raw.trim()) ? raw.trim().slice(1) : undefined;
  return { query: typed ? "" : raw.trim(), tag: tag ?? typed };
}

/**
 * Búsqueda mientras se escribe: consulta la API pública desde el navegador con una pausa corta
 * y deja la URL al día. Sin JavaScript, el formulario sigue funcionando contra la página.
 */
export function SearchBox({
  apiUrl,
  initialQ,
  initialTag,
  initial,
  children,
}: {
  apiUrl: string;
  initialQ: string;
  initialTag?: string;
  initial: ThreadSearchResult[];
  /** Lo que se enseña con la caja vacía: hilos destacados. */
  children: React.ReactNode;
}) {
  const [q, setQ] = useState(initialQ);
  const [tag, setTag] = useState(initialTag);
  const [threads, setThreads] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const first = useRef(true);
  const { query, tag: effectiveTag } = parse(q, tag);
  const active = Boolean(query || effectiveTag);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const url = new URL(window.location.href);
    url.search = "";
    if (q.trim()) url.searchParams.set("q", q.trim());
    if (tag) url.searchParams.set("tag", tag);
    window.history.replaceState(null, "", url);
    if (!active) {
      setThreads([]);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const p = new URLSearchParams({ q: query });
        if (effectiveTag) p.set("tag", effectiveTag);
        const res = await fetch(`${apiUrl}/v1/search?${p}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(String(res.status));
        setThreads(((await res.json()) as { threads: ThreadSearchResult[] }).threads);
        setFailed(false);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setFailed(true);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [q, tag, query, effectiveTag, active, apiUrl]);

  return (
    <div className="space-y-6">
      <form action="/search" className="flex gap-2" role="search" onSubmit={(e) => e.preventDefault()}>
        <div className="relative min-w-0 flex-1">
          <svg viewBox="0 0 20 20" width="16" height="16" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <circle cx="8.5" cy="8.5" r="5.5" />
            <path d="m13 13 4 4" />
          </svg>
          <input
            type="search"
            name="q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
            autoComplete="off"
            placeholder="Title, question or #tag"
            className="w-full rounded-lg border border-line bg-panel py-2.5 pl-9 pr-3 text-base sm:text-sm focus:border-ink focus:outline-none"
            aria-label="Search threads"
          />
        </div>
        {tag && <input type="hidden" name="tag" value={tag} />}
      </form>
      {tag && (
        <p className="text-sm text-muted">
          Only threads tagged <span className="font-mono">#{tag}</span> ·{" "}
          <button type="button" onClick={() => setTag(undefined)} className="underline hover:text-ink">
            remove
          </button>
        </p>
      )}
      {active ? (
        <section aria-live="polite" aria-busy={loading} className="space-y-3">
          <p className="text-sm text-muted">
            {failed
              ? "Search is not reachable right now. Try again in a moment."
              : loading && threads.length === 0
                ? "Searching…"
                : `${threads.length} ${threads.length === 1 ? "thread" : "threads"}${loading ? " · updating…" : ""}`}
          </p>
          {!loading && !failed && threads.length === 0 && (
            <p className="rounded-xl border border-dashed border-line p-6 text-center text-muted">
              No threads match. Try fewer words, a tag like <span className="font-mono">#f1</span>, or{" "}
              <Link href="/labs" className="text-accent underline underline-offset-2">
                browse the labs
              </Link>
              .
            </p>
          )}
          <ul className={`space-y-3 transition-opacity ${loading ? "opacity-60" : ""}`}>
            {threads.map((t) => (
              <li key={`${t.lab_slug}/${t.slug}`}>
                <ThreadResult t={t} />
              </li>
            ))}
          </ul>
        </section>
      ) : (
        children
      )}
    </div>
  );
}
