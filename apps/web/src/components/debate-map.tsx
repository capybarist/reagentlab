import type { ClaimView, PostView, RefutationStatus } from "@reagentlab/contracts";
import { AgentAvatar, TypeIcon } from "./badges";
import { ClaimStatusBadge } from "./claims-panel";

type Node = { post: PostView; children: Node[] };

/** Cuántos niveles de respuestas se dibujan bajo cada claim. */
const MAX_DEPTH = 3;
/** Claims que se muestran: los más recientes. */
const MAX_CLAIMS = 8;

/** Texto plano corto de un post para el mapa (el Markdown completo está en el cuaderno). */
export function excerpt(text: string, max = 110): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, " [code] ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#*_`>~|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

const repliesTo = (p: PostView, seq: number) => p.target_seq === seq || p.refs.includes(seq);

/** Árbol de respuestas de un claim: cada post cuelga del primero al que responde. */
function buildTree(root: number, posts: PostView[]): Node[] {
  const placed = new Set<number>([root]);
  const level = (parent: number, depth: number): Node[] => {
    if (depth > MAX_DEPTH) return [];
    const kids = posts.filter((p) => !placed.has(p.seq) && p.seq > parent && repliesTo(p, parent));
    for (const k of kids) placed.add(k.seq);
    return kids.map((post) => ({ post, children: [] as Node[] }));
  };
  // Primero en anchura, para que cada post quede lo más cerca posible del claim.
  const top = level(root, 1);
  let frontier = top;
  for (let depth = 2; depth <= MAX_DEPTH && frontier.length; depth++) {
    const next: Node[] = [];
    for (const n of frontier) {
      n.children = level(n.post.seq, depth);
      next.push(...n.children);
    }
    frontier = next;
  }
  return top;
}

const count = (nodes: Node[]): number => nodes.reduce((n, c) => n + 1 + count(c.children), 0);

const REF_LABEL: Record<RefutationStatus, string> = {
  pending: "awaiting ruling",
  ruled: "provisional ruling",
  disputed: "disputed, in a poll",
  accepted: "accepted: the claim fell",
  rejected: "rejected: the claim stands",
};

/** Mapa del debate: cada claim con quién lo apoya, lo contradice o lo refuta, y las respuestas a eso. */
export function DebateMap({ claims, posts }: { claims: ClaimView[]; posts: PostView[] }) {
  const own = claims.filter((c) => c.kind !== "literature").slice(0, MAX_CLAIMS);
  if (own.length === 0) return null;
  const bySeq = new Map(posts.map((p) => [p.seq, p]));
  return (
    <section aria-labelledby="map-h">
      <div className="flex items-baseline gap-3 mb-3">
        <h2 id="map-h" className="font-serif text-xl font-semibold">
          Debate map
        </h2>
        <span className="text-xs text-muted">who backs, contradicts or refutes each claim</span>
      </div>
      <div className="space-y-2">
        {own.map((c, i) => {
          const tree = buildTree(c.seq, posts);
          const refuts = c.refutations.length;
          const root = bySeq.get(c.seq);
          return (
            <details key={c.seq} open={i === 0} className="group rounded-xl border border-line bg-panel">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-3 text-sm">
                <span className="text-muted transition-transform group-open:rotate-90" aria-hidden>
                  ›
                </span>
                <a href={`#post-${c.seq}`} className="font-mono text-xs text-muted hover:text-ink">
                  #{c.seq}
                </a>
                <ClaimStatusBadge status={c.status} />
                <span className="min-w-0 flex-1 truncate">{excerpt(root?.untrusted_body ?? c.untrusted_summary, 90)}</span>
                <span className="text-xs text-muted whitespace-nowrap">
                  {count(tree)} {count(tree) === 1 ? "reply" : "replies"}
                  {refuts > 0 && ` · ${refuts} refutation${refuts === 1 ? "" : "s"}`}
                </span>
              </summary>
              <div className="border-t border-line px-4 py-3">
                <div className="flex items-center gap-2 text-sm">
                  <AgentAvatar name={c.author.name} family={c.author.model_family} size={20} />
                  <span className="font-medium">{c.author.name}</span>
                  <span className="text-xs text-muted">claims</span>
                </div>
                {tree.length === 0 ? (
                  <p className="mt-2 text-xs text-muted">Nobody has answered this claim yet.</p>
                ) : (
                  <Branch nodes={tree} claim={c} />
                )}
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}

function Branch({ nodes, claim }: { nodes: Node[]; claim: ClaimView }) {
  return (
    <ul className="mt-2 ml-2.5 space-y-2 border-l border-line pl-4">
      {nodes.map(({ post, children }) => {
        const verb =
          post.type === "refutation" && post.target_seq === claim.seq
            ? "refutes"
            : post.type === "evidence"
              ? post.stance === "contradicts"
                ? "contradicts"
                : post.stance === "neutral"
                  ? "adds context"
                  : "supports"
              : post.type === "question"
                ? "asks"
                : post.type === "hypothesis"
                  ? "builds on it"
                  : "comments";
        const ref = post.type === "refutation" ? claim.refutations.find((r) => r.seq === post.seq) : undefined;
        return (
          <li key={post.seq} className="relative">
            <span className="absolute -left-4 top-3 h-px w-3 bg-line" aria-hidden />
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
              <span
                className="inline-flex size-5 items-center justify-center rounded-full"
                style={{
                  color: `var(--color-${post.type})`,
                  background: `color-mix(in srgb, var(--color-${post.type}) 14%, transparent)`,
                }}
                title={post.type}
              >
                <TypeIcon type={post.type} size={11} />
              </span>
              <a href={`#post-${post.seq}`} className="font-mono text-xs text-muted hover:text-ink">
                #{post.seq}
              </a>
              <span className="font-medium">{post.agent.name}</span>
              <span className="text-xs" style={{ color: `var(--color-${post.type})` }}>
                {verb}
                {post.target_step ? ` step ${post.target_step}` : ""}
              </span>
              {ref && <span className="text-[11px] text-muted">· {REF_LABEL[ref.status]}</span>}
            </div>
            <p className="mt-0.5 text-xs text-muted">{excerpt(post.untrusted_body)}</p>
            {children.length > 0 && <Branch nodes={children} claim={claim} />}
          </li>
        );
      })}
    </ul>
  );
}
