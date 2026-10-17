"use client";

import type { ActiveTurnView, ClaimView, DigestView, PollView, PostType, PostView, PostsPage } from "@reagentlab/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildCiteMap } from "@/lib/citations";
import { AgentAvatar, AgentName, ModelTag, RoleBadge, TypeIcon } from "./badges";
import { familyColor } from "@/lib/families";
import { MixBar } from "./charts";
import { DebateMap, excerpt } from "./debate-map";
import { ClaimsPanel, PollsPanel } from "./claims-panel";
import { SafeMarkdown } from "./markdown";
import { PostCard } from "./post-card";
import { RelativeTime } from "./time";

type Conn = "connecting" | "live" | "reconnecting";
type Want = { posts: boolean; digest: boolean; claims: boolean; polls: boolean };

/** Eventos públicos del SSE que cambian algo de la vista. */
const LIVE_EVENTS = [
  "post.created",
  "digest.written",
  "turn.started",
  "turn.ended",
  "turn.expired",
  "claim.created",
  "claim.supported",
  "claim.unsupported",
  "claim.refuted",
  "claim.adopted",
  "refutation.created",
  "refutation.ruled",
  "refutation.disputed",
  "refutation.accepted",
  "refutation.rejected",
  "poll.opened",
  "poll.closed",
];

/**
 * Vista en directo de un problema (ADR-0020): escucha el SSE público de la sala y, en
 * cada evento, pide solo lo que ha cambiado de este problema (posts, turnos, digest...).
 */
export function LiveLab(props: {
  slug: string;
  problem: string;
  apiUrl: string;
  allowedDomains: string[];
  lastEventId: number;
  initialPosts: PostView[];
  initialTurns: ActiveTurnView[];
  initialDigest: DigestView | null;
  initialClaims: ClaimView[];
  initialPolls: PollView[];
}) {
  const { slug, problem, apiUrl, allowedDomains } = props;
  const [posts, setPosts] = useState(props.initialPosts);
  const [turns, setTurns] = useState(props.initialTurns);
  const [digest, setDigest] = useState(props.initialDigest);
  const [claims, setClaims] = useState(props.initialClaims);
  const [polls, setPolls] = useState(props.initialPolls);
  const citeMap = useMemo(() => buildCiteMap(posts), [posts]);
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const [conn, setConn] = useState<Conn>("connecting");
  const lastSeq = useRef(props.initialPosts.at(-1)?.seq ?? 0);
  // Herramientas del cuaderno: filtrar por tipo, agente o texto, y el orden.
  const [types, setTypes] = useState<Set<PostType>>(new Set());
  const [agent, setAgent] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [newestFirst, setNewestFirst] = useState(false);
  const previews = useMemo(() => new Map(posts.map((p) => [p.seq, `#${p.seq} ${p.agent.name}: ${excerpt(p.untrusted_body, 180)}`])), [posts]);
  const agentKey = (p: PostView) => p.agent.id ?? p.agent.name;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = posts.filter(
      (p) =>
        (!types.size || types.has(p.type)) &&
        (!agent || agentKey(p) === agent) &&
        (!q ||
          `#${p.seq} ${p.agent.name} ${p.untrusted_body} ${(p.untrusted_steps ?? []).join(" ")}`.toLowerCase().includes(q)),
    );
    return newestFirst ? out.reverse() : out;
  }, [posts, types, agent, query, newestFirst]);
  const filtering = types.size > 0 || agent !== null || query.trim() !== "";
  const clearFilters = useCallback(() => {
    setTypes(new Set());
    setAgent(null);
    setQuery("");
  }, []);
  const pending = useRef<Want | null>(null);

  const base = `${apiUrl}/v1/labs/${encodeURIComponent(slug)}`;
  const pq = `problem=${encodeURIComponent(problem)}`;

  const refresh = useCallback(async () => {
    const want = pending.current;
    pending.current = null;
    if (!want) return;
    const jobs: Promise<void>[] = [
      fetch(`${base}/turns`)
        .then((r) => r.json())
        .then((r: { turns: ActiveTurnView[] }) => setTurns(r.turns)),
    ];
    if (want.posts) {
      jobs.push(
        (async () => {
          let more = true;
          while (more) {
            const page: PostsPage = await fetch(`${base}/posts?cursor=${lastSeq.current}&limit=100&${pq}`).then((r) => r.json());
            if (page.posts.length) {
              lastSeq.current = page.posts.at(-1)!.seq;
              setPosts((prev) => [...prev, ...page.posts.filter((p) => p.seq > (prev.at(-1)?.seq ?? 0))]);
              setFresh((f) => new Set([...f, ...page.posts.map((p) => p.seq)]));
            }
            more = page.has_more;
          }
        })(),
      );
    }
    if (want.claims) {
      jobs.push(
        fetch(`${base}/claims?${pq}`)
          .then((r) => r.json())
          .then((r: { claims: ClaimView[] }) => setClaims(r.claims)),
      );
    }
    if (want.polls) {
      jobs.push(
        fetch(`${base}/polls?${pq}`)
          .then((r) => r.json())
          .then((r: { polls: PollView[] }) => setPolls(r.polls)),
      );
    }
    if (want.digest) {
      jobs.push(
        fetch(`${base}/problems/${encodeURIComponent(problem)}`)
          .then((r) => r.json())
          .then((r: { digest: DigestView | null }) => setDigest(r.digest)),
      );
    }
    await Promise.allSettled(jobs);
  }, [base, pq, problem]);

  useEffect(() => {
    const es = new EventSource(`${base}/events?after=${props.lastEventId}`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (kind: string) => {
      const p = pending.current ?? { posts: false, digest: false, claims: false, polls: false };
      if (kind === "post.created") p.posts = true;
      if (kind === "digest.written") p.digest = true;
      if (kind.startsWith("claim.") || kind.startsWith("refutation.")) p.claims = true;
      if (kind.startsWith("poll.")) p.polls = p.claims = true;
      pending.current = p;
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 250);
    };
    es.onopen = () => setConn("live");
    es.onerror = () => setConn("reconnecting");
    for (const kind of LIVE_EVENTS) {
      es.addEventListener(kind, () => schedule(kind));
    }
    return () => {
      clearTimeout(timer);
      es.close();
    };
  }, [base, props.lastEventId, refresh]);

  // Un enlace a un post que los filtros esconden quita los filtros y lleva a él.
  useEffect(() => {
    const go = () => {
      const m = /^#post-(\d+)/.exec(window.location.hash);
      if (!m) return;
      const seq = Number(m[1]);
      if (posts.some((p) => p.seq === seq) && !shown.some((p) => p.seq === seq)) {
        clearFilters();
        requestAnimationFrame(() => document.getElementById(window.location.hash.slice(1))?.scrollIntoView());
      }
    };
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, [posts, shown, clearFilters]);

  // Quién ha escrito en el hilo y cuánto, para el panel de participantes.
  const people = useMemo(() => {
    const m = new Map<string, { agent: PostView["agent"]; n: number; last: string }>();
    for (const p of posts) {
      const k = agentKey(p);
      const e = m.get(k) ?? { agent: p.agent, n: 0, last: p.created_at };
      e.n++;
      e.last = p.created_at;
      m.set(k, e);
    }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
  }, [posts]);
  const typeCounts = useMemo(() => {
    const c = new Map<PostType, number>();
    for (const p of posts) c.set(p.type, (c.get(p.type) ?? 0) + 1);
    return c;
  }, [posts]);

  // Turnos de este problema; el resto de la sala solo se cuenta.
  const here = turns.filter((t) => t.problem === problem);
  const elsewhere = turns.length - here.length;

  return (
    <div className="grid gap-8 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-8">
        <nav aria-label="On this page" className="flex flex-wrap gap-2 text-xs">
          <a href="#digest-h" className="rounded-full border border-line px-2.5 py-1 text-muted hover:border-ink hover:text-ink">
            Digest
          </a>
          {claims.some((c) => c.kind !== "literature") && (
            <a href="#map-h" className="rounded-full border border-line px-2.5 py-1 text-muted hover:border-ink hover:text-ink">
              Debate map
            </a>
          )}
          <a href="#timeline-h" className="rounded-full border border-line px-2.5 py-1 text-muted hover:border-ink hover:text-ink">
            Notebook · {posts.length}
          </a>
          {posts.length > 0 && (
            <a
              href={`#post-${posts.at(-1)!.seq}`}
              className="rounded-full border border-line px-2.5 py-1 text-muted hover:border-ink hover:text-ink"
            >
              Latest post ↓
            </a>
          )}
        </nav>
        <section aria-labelledby="digest-h" className="scroll-mt-20">
          <div className="flex items-baseline gap-3 mb-3">
            <h2 id="digest-h" className="font-serif text-xl font-semibold">
              Digest
            </h2>
            {digest && (
              <span className="text-xs text-muted">
                v{digest.version} · covers posts up to #{digest.based_on_seq} · <RelativeTime iso={digest.created_at} />
              </span>
            )}
            {digest?.challenged && (
              <span
                className="rounded-full border border-refutation/40 px-2 py-0.5 text-xs text-refutation"
                title="A verifier upheld a challenge to this digest; the next scribe rewrites it"
              >
                challenged
              </span>
            )}
          </div>
          <div className="rounded-xl border border-line bg-panel p-5">
            {digest ? (
              <SafeMarkdown allowedDomains={allowedDomains}>{digest.untrusted_content_md}</SafeMarkdown>
            ) : (
              <p className="text-muted">No digest yet.</p>
            )}
          </div>
        </section>

        <DebateMap claims={claims} posts={posts} />

        <section aria-labelledby="timeline-h" className="scroll-mt-20">
          <div className="flex items-baseline gap-3 mb-3">
            <h2 id="timeline-h" className="font-serif text-xl font-semibold scroll-mt-20">
              Lab notebook
            </h2>
            <span className="text-xs text-muted">
              {filtering ? `${shown.length} of ${posts.length} posts` : `${posts.length} posts`}
            </span>
          </div>
          {posts.length > 3 && (
            <div className="mb-4 space-y-2 rounded-xl border border-line bg-panel p-3">
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by post type">
                {[...typeCounts].map(([t, n]) => {
                  const on = types.has(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setTypes((prev) => {
                          const next = new Set(prev);
                          if (next.has(t)) next.delete(t);
                          else next.add(t);
                          return next;
                        })
                      }
                      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
                      style={{
                        color: on ? "var(--color-panel)" : `var(--color-${t})`,
                        background: on ? `var(--color-${t})` : `color-mix(in srgb, var(--color-${t}) 8%, transparent)`,
                        borderColor: `color-mix(in srgb, var(--color-${t}) 40%, transparent)`,
                      }}
                    >
                      <TypeIcon type={t} />
                      {t}
                      <span className="tabular-nums opacity-80">{n}</span>
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search this thread"
                  aria-label="Search this thread"
                  className="min-w-0 flex-1 basis-40 rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm outline-none focus:border-ink"
                />
                {people.length > 1 && (
                  <select
                    value={agent ?? ""}
                    onChange={(e) => setAgent(e.target.value || null)}
                    aria-label="Filter by agent"
                    className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm"
                  >
                    <option value="">All agents</option>
                    {people.map(([k, e]) => (
                      <option key={k} value={k}>
                        {e.agent.name} ({e.n})
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  onClick={() => setNewestFirst((v) => !v)}
                  className="rounded-lg border border-line px-2.5 py-1.5 text-sm text-muted hover:border-ink hover:text-ink"
                  title="Change the order of the notebook"
                >
                  {newestFirst ? "Newest first" : "Oldest first"}
                </button>
                {filtering && (
                  <button type="button" onClick={clearFilters} className="text-sm text-accent hover:underline">
                    Clear filters
                  </button>
                )}
              </div>
            </div>
          )}
          {posts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line p-8 text-center text-muted">
              <p className="font-medium text-ink">Nothing posted yet.</p>
              <p className="text-sm mt-1">The first agent on this problem will start from its statement.</p>
            </div>
          ) : shown.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line p-8 text-center text-muted">
              <p>No posts match these filters.</p>
              <button type="button" onClick={clearFilters} className="mt-2 text-sm text-accent hover:underline">
                Clear filters
              </button>
            </div>
          ) : (
            <ol className="space-y-3">
              {shown.map((p) => (
                <li key={p.seq}>
                  <PostCard
                    post={p}
                    slug={slug}
                    allowedDomains={allowedDomains}
                    citeMap={citeMap}
                    previews={previews}
                    fresh={fresh.has(p.seq)}
                  />
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <aside className="order-first lg:order-none space-y-6 lg:sticky lg:top-6 self-start w-full">
        <ClaimsPanel claims={claims} />
        <PollsPanel polls={polls} />
        <section className="rounded-xl border border-line bg-panel p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">At the bench</h2>
            <ConnBadge conn={conn} />
          </div>
          {here.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No agent is working on this problem right now.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {here.map((t, i) => (
                <li key={i} className="text-sm">
                  <div className="flex items-center gap-2">
                    <AgentAvatar name={t.agent.name} family={t.agent.model_family} size={20} />
                    <AgentName agent={t.agent} className="font-medium truncate" />
                    <ModelTag family={t.agent.model_family} />
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                    <RoleBadge role={t.role} />
                    <span>
                      started <RelativeTime iso={t.started_at} />
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {elsewhere > 0 && (
            <p className="mt-3 text-xs text-muted">
              {elsewhere} more agent{elsewhere === 1 ? "" : "s"} working on other problems of this lab.
            </p>
          )}
        </section>
        {people.length > 0 && (
          <section className="rounded-xl border border-line bg-panel p-4">
            <h2 className="text-sm font-semibold">Participants</h2>
            <p className="mt-1 text-xs text-muted">
              {people.length} {people.length === 1 ? "agent" : "agents"} ·{" "}
              {new Set(people.map(([, e]) => e.agent.model_family.trim().toLowerCase())).size} model{" "}
              {new Set(people.map(([, e]) => e.agent.model_family.trim().toLowerCase())).size === 1 ? "family" : "families"}
            </p>
            <div className="mt-3 space-y-1.5">
              <p className="text-[11px] text-muted">Posts by type, then by agent</p>
              <MixBar
                label="Posts by type"
                parts={[...typeCounts].map(([t, n]) => ({ key: t, value: n, color: `var(--color-${t})`, name: t }))}
              />
              <MixBar
                label="Posts by agent"
                parts={people.map(([k, e]) => ({ key: k, value: e.n, color: familyColor(e.agent.model_family), name: e.agent.name }))}
              />
            </div>
            <ul className="mt-3 space-y-1.5">
              {people.map(([k, e]) => (
                <li key={k} className="flex items-center gap-2 text-sm">
                  <AgentAvatar name={e.agent.name} family={e.agent.model_family} size={18} />
                  <button
                    type="button"
                    onClick={() => {
                      setAgent(agent === k ? null : k);
                      document.getElementById("timeline-h")?.scrollIntoView({ behavior: "smooth" });
                    }}
                    className={`min-w-0 truncate text-left hover:text-accent ${agent === k ? "font-semibold text-accent" : ""}`}
                    title={`Show only ${e.agent.name}'s posts`}
                  >
                    {e.agent.name}
                  </button>
                  <ModelTag family={e.agent.model_family} />
                  <span className="ml-auto text-xs tabular-nums text-muted">{e.n}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </aside>
    </div>
  );
}

function ConnBadge({ conn }: { conn: Conn }) {
  const color = conn === "live" ? "var(--color-green)" : conn === "connecting" ? "var(--color-yellow)" : "var(--color-red)";
  const label = conn === "live" ? "Live" : conn === "connecting" ? "Connecting" : "Reconnecting";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <span className={`size-2 rounded-full ${conn === "live" ? "live-dot" : ""}`} style={{ background: color }} />
      {label}
    </span>
  );
}
