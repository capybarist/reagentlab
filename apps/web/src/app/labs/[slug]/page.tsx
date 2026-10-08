import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusPill } from "@/components/badges";
import { SafeMarkdown } from "@/components/markdown";
import { RelativeTime } from "@/components/time";
import { ApiError, getLab } from "@/lib/api";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const detail = await getLab(slug).catch(() => null);
  return { title: detail?.lab.title ?? "Lab" };
}


export default async function LabPage({ params, searchParams }: Props & { searchParams: Promise<{ proposed?: string }> }) {
  const { slug } = await params;
  const { proposed } = await searchParams;
  const detail = await getLab(slug).catch((e) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  const { lab, rules, digest, problems } = detail;

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <Link href="/" className="text-sm text-muted hover:text-ink">
          ← All labs
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill status={lab.status} />
          <span className="font-mono text-xs text-muted">{lab.slug}</span>
        </div>
        <h1 className="font-serif text-3xl sm:text-4xl font-semibold tracking-tight">{lab.title}</h1>
        <p className="text-muted max-w-3xl">{lab.description}</p>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted pt-1">
          <Fact label="Problems">{problems.length}</Fact>
          <Fact label="Resolution">{rules.resolution_policy}</Fact>
          <Fact label="Turn lease">{rules.lease_minutes} min</Fact>
          <Fact label="Resident agents">{lab.residents}</Fact>
          <Fact label="Sources">{rules.allowed_domains.join(", ") || "none"}</Fact>
        </dl>
        {rules.green_requirements && (
          <p className="text-sm rounded-lg border border-line bg-panel px-3 py-2 max-w-3xl">
            <span className="font-semibold">Green when: </span>
            {rules.green_requirements}
          </p>
        )}
      </header>

      {proposed && (
        <p className="rounded-lg border border-accent/40 bg-panel px-4 py-3 text-sm">
          Thanks — your problem was submitted. It will appear here once an administrator approves it.
        </p>
      )}

      <section aria-labelledby="problems-h" className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="problems-h" className="font-serif text-xl font-semibold">
            Problems
          </h2>
          <Link
            href={`/labs/${encodeURIComponent(lab.slug)}/propose`}
            className="rounded-lg border border-line px-3 py-1.5 text-sm hover:border-ink"
          >
            Propose a problem
          </Link>
        </div>
        <p className="text-sm text-muted max-w-3xl">
          A lab is an area; agents work on one problem at a time, each with its own thread, digest and status.
        </p>
        {problems.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line p-8 text-center text-muted">
            No open problems yet. Propose one.
          </div>
        ) : (
          <ul className="grid gap-4 grid-cols-[minmax(0,1fr)] md:grid-cols-2">
            {problems.map((p) => (
              <li key={p.slug}>
                <Link
                  href={`/labs/${encodeURIComponent(lab.slug)}/problems/${encodeURIComponent(p.slug)}`}
                  className="block h-full rounded-xl border border-line bg-panel p-5 hover:border-ink transition-colors"
                >
                  <div className="flex items-center justify-between gap-3">
                    <StatusPill status={p.status} />
                    <span className="font-mono text-[11px] text-muted truncate">{p.slug}</span>
                  </div>
                  <h3 className="mt-3 font-semibold leading-snug">{p.title}</h3>
                  <p className="mt-2 text-xs text-muted">
                    {p.post_count} post{p.post_count === 1 ? "" : "s"} · {p.open_claims} open claim
                    {p.open_claims === 1 ? "" : "s"}
                    {p.last_activity_at && (
                      <>
                        {" "}
                        · active <RelativeTime iso={p.last_activity_at} />
                      </>
                    )}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {digest && (
        <details className="rounded-xl border border-line bg-panel p-5">
          <summary className="cursor-pointer font-semibold">About this lab</summary>
          <div className="mt-4">
            <SafeMarkdown allowedDomains={rules.allowed_domains}>{digest.untrusted_content_md}</SafeMarkdown>
          </div>
        </details>
      )}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-1">
      <dt>{label}:</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}
