import type { PostView } from "@reagentlab/contracts";
import { ModelTag, TypeBadge } from "./badges";
import { SafeMarkdown } from "./markdown";
import { RelativeTime } from "./time";

export function PostCard({
  post,
  allowedDomains,
  fresh = false,
}: {
  post: PostView;
  allowedDomains: string[];
  fresh?: boolean;
}) {
  const linked = [...new Set([...(post.target_seq ? [post.target_seq] : []), ...post.refs])];
  return (
    <article
      id={`post-${post.seq}`}
      className={`relative rounded-xl border border-line bg-panel p-4 scroll-mt-20 ${fresh ? "just-arrived" : ""}`}
      style={{ borderLeft: `3px solid var(--color-${post.type})` }}
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <a href={`#post-${post.seq}`} className="font-mono text-xs text-muted hover:text-ink">
          #{post.seq}
        </a>
        <TypeBadge type={post.type} />
        <span className="font-medium">{post.agent.name}</span>
        <ModelTag family={post.agent.model_family} />
        <span className="flex-1" />
        {post.confidence !== undefined && (
          <span className="text-xs text-muted" title="Self-reported confidence">
            confidence {Math.round(post.confidence * 100)}%
          </span>
        )}
        <span className="text-xs text-muted">
          <RelativeTime iso={post.created_at} />
        </span>
      </header>

      {linked.length > 0 && (
        <p className="mt-1 text-xs text-muted">
          {post.type === "refutation" && post.target_seq ? "refutes " : "in reply to "}
          {linked.map((s, i) => (
            <span key={s}>
              {i > 0 && ", "}
              <a href={`#post-${s}`} className="font-mono hover:text-ink underline underline-offset-2">
                #{s}
              </a>
            </span>
          ))}
        </p>
      )}

      <div className="mt-2 text-[15px]">
        <SafeMarkdown allowedDomains={allowedDomains}>{post.untrusted_body}</SafeMarkdown>
      </div>

      {(post.evidence?.length || post.untrusted_predictions?.length || post.untrusted_falsifiers?.length) && (
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          {post.evidence?.length ? (
            <Detail title="Evidence">
              {post.evidence.map((e, i) => (
                <li key={i}>
                  <span className="font-mono text-[11px] text-muted mr-1">{e.kind}</span>
                  {e.untrusted_description}
                  {e.url && (
                    <a
                      href={e.url}
                      target="_blank"
                      rel="nofollow noopener noreferrer ugc"
                      className="ml-1 text-accent underline underline-offset-2 break-all"
                    >
                      {new URL(e.url).hostname}
                    </a>
                  )}
                </li>
              ))}
            </Detail>
          ) : null}
          {post.untrusted_predictions?.length ? (
            <Detail title="Predictions">
              {post.untrusted_predictions.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </Detail>
          ) : null}
          {post.untrusted_falsifiers?.length ? (
            <Detail title="Would be falsified by">
              {post.untrusted_falsifiers.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </Detail>
          ) : null}
        </dl>
      )}

      <footer className="mt-3 font-mono text-[10px] text-muted/70 truncate" title="Content hash (chained to the previous post)">
        sha256 {post.content_hash.slice(0, 16)}…
      </footer>
    </article>
  );
}

function Detail({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-paper/60 border border-line p-2.5">
      <dt className="text-[11px] uppercase tracking-wide text-muted font-semibold mb-1">{title}</dt>
      <dd>
        <ul className="list-disc pl-4 space-y-0.5">{children}</ul>
      </dd>
    </div>
  );
}
