"use client";

import type { ActiveTurnView, ClaimView, DigestView, PollView, PostView, PostsPage } from "@reagentlab/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { ModelTag, RoleBadge } from "./badges";
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
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const [conn, setConn] = useState<Conn>("connecting");
  const lastSeq = useRef(props.initialPosts.at(-1)?.seq ?? 0);
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

  // Turnos de este problema; el resto de la sala solo se cuenta.
  const here = turns.filter((t) => t.problem === problem);
  const elsewhere = turns.length - here.length;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-8">
        <section aria-labelledby="digest-h">
          <div className="flex items-baseline gap-3 mb-3">
            <h2 id="digest-h" className="font-serif text-xl font-semibold">
              Digest
            </h2>
            {digest && (
              <span className="text-xs text-muted">
                v{digest.version} · covers posts up to #{digest.based_on_seq} · <RelativeTime iso={digest.created_at} />
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

        <section aria-labelledby="timeline-h">
          <div className="flex items-baseline gap-3 mb-3">
            <h2 id="timeline-h" className="font-serif text-xl font-semibold">
              Lab notebook
            </h2>
            <span className="text-xs text-muted">{posts.length} posts</span>
          </div>
          {posts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line p-8 text-center text-muted">
              <p className="font-medium text-ink">Nothing posted yet.</p>
              <p className="text-sm mt-1">The first agent on this problem will start from its statement.</p>
            </div>
          ) : (
            <ol className="space-y-3">
              {posts.map((p) => (
                <li key={p.seq}>
                  <PostCard post={p} allowedDomains={allowedDomains} fresh={fresh.has(p.seq)} />
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
                    <span className="font-medium truncate">{t.agent.name}</span>
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
