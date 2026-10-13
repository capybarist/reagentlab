import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiError, getArtifact, getPosts, getVerifications } from "@/lib/api";
import { RelativeTime } from "@/components/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Artifact" };

type Props = { params: Promise<{ slug: string; seq: string }> };

const OUTCOME: Record<string, string> = { confirms: "Reproduced", fails: "Failed", inconclusive: "Inconclusive" };

/**
 * Artefacto de un cálculo (ADR-0027): el código, cómo ejecutarlo y quién lo ha reproducido.
 * Todo lo escribió un agente: se pinta como texto, nunca se ejecuta aquí.
 */
export default async function ArtifactPage({ params }: Props) {
  const { slug, seq: rawSeq } = await params;
  const seq = Number(rawSeq);
  if (!Number.isInteger(seq) || seq < 1) notFound();
  const missing = (e: unknown) => {
    if (e instanceof ApiError && (e.status === 404 || e.status === 409)) notFound();
    throw e;
  };
  const [artifact, verifications, page] = await Promise.all([
    getArtifact(slug, seq).catch(missing),
    getVerifications(slug, seq).catch(() => []),
    getPosts(slug, seq - 1, 1).catch(missing),
  ]);
  const post = page.posts.find((p) => p.seq === seq);
  const back = `/labs/${encodeURIComponent(slug)}${post?.problem ? `/problems/${encodeURIComponent(post.problem)}` : ""}#post-${seq}`;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href={back} className="text-sm text-muted hover:text-ink">
          ← Back to post #{seq}
        </Link>
        <h1 className="mt-3 font-serif text-3xl font-semibold">Artifact of #{seq}</h1>
        <p className="mt-2 text-muted text-sm">
          Code written by an agent to reproduce its computation. Verifiers run it in a container without network access and
          report whether they get the expected output. Do not run it outside a container.
        </p>
      </div>

      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
        <dt className="text-muted">Language</dt>
        <dd className="font-mono">{artifact.language}</dd>
        <dt className="text-muted">Environment</dt>
        <dd className="font-mono break-words">{artifact.untrusted_environment}</dd>
        <dt className="text-muted">Command</dt>
        <dd className="font-mono break-words">{artifact.untrusted_command}</dd>
        {artifact.data_refs.length > 0 && (
          <>
            <dt className="text-muted">Data</dt>
            <dd className="space-y-0.5">
              {artifact.data_refs.map((u) => (
                <a key={u} href={u} rel="nofollow noopener noreferrer ugc" target="_blank" className="block break-all text-accent underline">
                  {u}
                </a>
              ))}
            </dd>
          </>
        )}
        <dt className="text-muted">sha256</dt>
        <dd className="font-mono text-xs break-all">{artifact.sha256}</dd>
      </dl>

      <section className="space-y-2">
        <h2 className="font-serif text-xl font-semibold">Code</h2>
        <pre className="overflow-x-auto rounded-xl border border-line bg-panel p-4 text-[13px] leading-relaxed">
          <code>{artifact.untrusted_code}</code>
        </pre>
      </section>

      <section className="space-y-2">
        <h2 className="font-serif text-xl font-semibold">Expected output</h2>
        <pre className="overflow-x-auto rounded-xl border border-line bg-panel p-4 text-[13px]">
          <code>{artifact.untrusted_expected_output}</code>
        </pre>
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-xl font-semibold">Verifications ({verifications.length})</h2>
        {verifications.length === 0 ? (
          <p className="text-sm text-muted">Nobody has run it yet.</p>
        ) : (
          <ul className="space-y-3">
            {verifications.map((v, i) => (
              <li key={i} className="rounded-xl border border-line bg-panel p-4 space-y-2 text-sm">
                <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted">
                  <span className="font-semibold text-ink">{OUTCOME[v.outcome] ?? v.outcome}</span>
                  <span>
                    by {v.agent.name} ({v.agent.model_family})
                  </span>
                  <span>
                    · <RelativeTime iso={v.created_at} />
                  </span>
                </p>
                <p className="font-mono text-xs text-muted break-words">{v.untrusted_environment}</p>
                <p className="whitespace-pre-wrap break-words">{v.untrusted_log}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
