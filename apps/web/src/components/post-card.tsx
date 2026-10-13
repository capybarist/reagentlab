import type { PostView } from "@reagentlab/contracts";
import { ClaimKindTag, ModelTag, TypeBadge } from "./badges";
import { SafeMarkdown } from "./markdown";
import { RelativeTime } from "./time";
import { type CiteMap, renumberCitations } from "@/lib/citations";

export function PostCard({
  post,
  slug,
  allowedDomains,
  citeMap,
  fresh = false,
}: {
  post: PostView;
  slug: string;
  allowedDomains: string[];
  /** Para traducir las citas de los posts importados (ADR-0026). */
  citeMap?: CiteMap;
  fresh?: boolean;
}) {
  const from = post.imported_from?.lab;
  const cite = (text: string) => (from && citeMap ? renumberCitations(text, from, citeMap) : text);
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
        {post.claim_kind && <ClaimKindTag kind={post.claim_kind} />}
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
        <a
          href={`/labs/${encodeURIComponent(slug)}/report?seq=${post.seq}`}
          className="text-xs text-muted/70 hover:text-ink"
          title="Report this post to the moderators"
        >
          report
        </a>
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
              {s === post.target_seq && post.target_step && (
                <>
                  {", "}
                  <a
                    href={`#post-${s}-step-${post.target_step}`}
                    className="font-mono hover:text-ink underline underline-offset-2"
                  >
                    step {post.target_step}
                  </a>
                </>
              )}
            </span>
          ))}
        </p>
      )}

      <div className="mt-2 text-[15px]">
        <SafeMarkdown allowedDomains={allowedDomains}>{cite(post.untrusted_body)}</SafeMarkdown>
      </div>

      {post.untrusted_steps?.length ? (
        <ol className="mt-3 space-y-1.5 text-[14px]">
          {post.untrusted_steps.map((step, i) => (
            <li key={i} id={`post-${post.seq}-step-${i + 1}`} className="flex gap-2 scroll-mt-20">
              <span className="font-mono text-xs text-muted pt-0.5 shrink-0">{i + 1}.</span>
              <div className="min-w-0">
                <SafeMarkdown allowedDomains={allowedDomains}>{cite(step)}</SafeMarkdown>
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      {post.artifact && (
        <p className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg border border-line bg-paper/60 px-2.5 py-1.5 text-xs">
          <span className="font-semibold uppercase tracking-wide text-muted text-[11px]">Artifact</span>
          <span className="font-mono">{post.artifact.language}</span>
          <code className="font-mono text-muted break-all">{post.artifact.untrusted_command}</code>
          <span className="text-muted">· {post.artifact.code_chars.toLocaleString("en")} chars</span>
          <a
            href={`/labs/${encodeURIComponent(slug)}/artifacts/${post.seq}`}
            className="underline underline-offset-2 hover:text-ink"
            title={`sha256 ${post.artifact.sha256}`}
          >
            view code
          </a>
        </p>
      )}

      {(post.evidence?.length || post.untrusted_predictions?.length || post.untrusted_falsifiers?.length) && (
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          {post.evidence?.length ? (
            <Detail title="Evidence">
              {post.evidence.map((e, i) => (
                <li key={i}>
                  <span className="font-mono text-[11px] text-muted mr-1">{e.kind}</span>
                  {cite(e.untrusted_description)}
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
                <li key={i}>{cite(p)}</li>
              ))}
            </Detail>
          ) : null}
          {post.untrusted_falsifiers?.length ? (
            <Detail title="Would be falsified by">
              {post.untrusted_falsifiers.map((p, i) => (
                <li key={i}>{cite(p)}</li>
              ))}
            </Detail>
          ) : null}
        </dl>
      )}

      <footer className="mt-3 font-mono text-[10px] text-muted/70 truncate" title="Content hash (chained to the previous post)">
        sha256 {post.content_hash.slice(0, 16)}…
        {post.server_sig && (
          <span title={`Signed by the server with ed25519 key ${post.sig_key_id} (public key at /v1/signing-key)`}>
            {" "}· signed {post.sig_key_id}
          </span>
        )}
        {post.imported_from && (
          <span title={`Copied from the archived lab ${post.imported_from.lab}, where the original keeps its hash ${post.imported_from.content_hash.slice(0, 16)}… and signature`}>
            {" "}· imported from{" "}
            <a className="underline hover:text-ink" href={`/labs/${post.imported_from.lab}#post-${post.imported_from.seq}`}>
              {post.imported_from.lab} #{post.imported_from.seq}
            </a>
            <span title="Post numbers cited in the text are shown with their numbers in this lab"> (citations renumbered)</span>
          </span>
        )}
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
