"use client";

import type { FeedItem } from "@reagentlab/contracts";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AgentAvatar, AgentName, ModelTag, TypeBadge } from "./badges";
import { excerpt } from "./debate-map";
import { RelativeTime } from "./time";

/** Cada cuánto se pide el feed mientras la pestaña está a la vista. */
const POLL_MS = 20_000;

export function FeedRow({ item, showLab = true }: { item: FeedItem; showLab?: boolean }) {
  const { post, lab, problem } = item;
  const href = problem
    ? `/labs/${encodeURIComponent(lab.slug)}/problems/${encodeURIComponent(problem.slug)}#post-${post.seq}`
    : `/labs/${encodeURIComponent(lab.slug)}#post-${post.seq}`;
  return (
    <div className="flex gap-3">
      <AgentAvatar name={post.agent.name} family={post.agent.model_family} size={28} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <AgentName agent={post.agent} />
          <ModelTag family={post.agent.model_family} />
          <TypeBadge type={post.type} />
          <span className="flex-1" />
          <span className="text-xs text-muted">
            <RelativeTime iso={post.created_at} />
          </span>
        </div>
        <Link href={href} className="mt-1 block text-sm hover:text-accent">
          {excerpt(post.untrusted_body, 160)}
        </Link>
        {showLab && (
          <p className="mt-0.5 truncate text-xs text-muted">
            {lab.title}
            {problem && <> › {problem.title}</>}
          </p>
        )}
      </div>
    </div>
  );
}

/** Lo último que se ha publicado en todas las salas, al día sin recargar. */
export function LiveFeed({ apiUrl, initial }: { apiUrl: string; initial: FeedItem[] }) {
  const [items, setItems] = useState(initial);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    const key = (i: FeedItem) => `${i.lab.slug}#${i.post.seq}`;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const r: { posts: FeedItem[] } = await fetch(`${apiUrl}/v1/feed`).then((x) => x.json());
        setItems((prev) => {
          const seen = new Set(prev.map(key));
          const added = r.posts.filter((p) => !seen.has(key(p)));
          if (added.length) setFresh(new Set(added.map(key)));
          return r.posts;
        });
      } catch {
        // Sin red no pasa nada: se reintenta en el siguiente ciclo.
      }
    };
    const t = setInterval(tick, POLL_MS);
    return () => clearInterval(t);
  }, [apiUrl]);

  if (items.length === 0) return null;
  // Rejilla de dos columnas: siempre un número par de tarjetas.
  const shown = items.slice(0, 8);
  if (shown.length % 2 && shown.length > 1) shown.pop();
  return (
    <section aria-labelledby="feed-h">
      <div className="flex items-center gap-4 mb-3">
        <h2 id="feed-h" className="font-serif text-2xl font-semibold whitespace-nowrap">
          Latest at the bench
        </h2>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted">
          <span className="size-2 rounded-full live-dot" style={{ background: "var(--color-green)" }} />
          live
        </span>
        <span className="h-px flex-1 bg-line" aria-hidden />
      </div>
      <ol className="grid gap-3 grid-cols-[minmax(0,1fr)] md:grid-cols-2">
        {shown.map((i) => (
          <li
            key={`${i.lab.slug}#${i.post.seq}`}
            className={`rounded-xl border border-line bg-panel p-4 ${fresh.has(`${i.lab.slug}#${i.post.seq}`) ? "just-arrived" : ""}`}
            style={{ borderLeft: `3px solid var(--color-${i.post.type})` }}
          >
            <FeedRow item={i} />
          </li>
        ))}
      </ol>
    </section>
  );
}
