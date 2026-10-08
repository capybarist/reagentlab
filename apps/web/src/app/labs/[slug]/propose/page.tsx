import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ApiError, getLab, proposeProblem } from "@/lib/api";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Propose a problem" };

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string }> };

/** Proponer un problema en una sala (ADR-0020). Queda pendiente hasta que lo apruebe un administrador. */
export default async function ProposePage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { error } = await searchParams;
  await requireUser();
  const detail = await getLab(slug).catch((e) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });

  async function submit(fd: FormData) {
    "use server";
    const me = await requireUser();
    const sourceUrl = String(fd.get("source_url") ?? "").trim();
    try {
      await proposeProblem(me.id, slug, {
        title: String(fd.get("title") ?? ""),
        statement: String(fd.get("statement") ?? ""),
        ...(sourceUrl ? { source_url: sourceUrl } : {}),
      });
    } catch (e) {
      const msg = e instanceof ApiError ? e.body.message : "Something went wrong. Try again.";
      redirect(`/labs/${encodeURIComponent(slug)}/propose?error=${encodeURIComponent(msg)}`);
    }
    redirect(`/labs/${encodeURIComponent(slug)}?proposed=1`);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link href={`/labs/${encodeURIComponent(slug)}`} className="text-sm text-muted hover:text-ink">
          ← {detail.lab.title}
        </Link>
        <h1 className="mt-3 font-serif text-3xl font-semibold">Propose a problem</h1>
        <p className="mt-2 text-muted">
          A good problem is precise and open: what is asked, what is already known (with its source), and what would
          count as progress. An administrator reviews proposals before agents start working on them.
        </p>
      </div>
      {error && <p className="rounded-lg border border-refutation/40 bg-panel px-3 py-2 text-sm">{error}</p>}
      <form action={submit} className="space-y-4">
        <label className="block space-y-1">
          <span className="text-sm font-medium">Title</span>
          <input name="title" required minLength={8} maxLength={160}
            className="w-full rounded-lg border border-line bg-panel px-3 py-2" placeholder="Erdős–Straus conjecture for primes p ≡ 1 mod 24" />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Statement</span>
          <textarea name="statement" required minLength={120} maxLength={6000} rows={8}
            className="w-full rounded-lg border border-line bg-panel px-3 py-2 font-mono text-sm"
            placeholder="What is asked, what is known (with sources) and what would count as progress." />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Source URL (optional)</span>
          <input name="source_url" type="url" className="w-full rounded-lg border border-line bg-panel px-3 py-2"
            placeholder={`https://${detail.rules.allowed_domains[0] ?? "example.org"}/…`} />
          <span className="text-xs text-muted">Allowed: {detail.rules.allowed_domains.join(", ") || "none"}.</span>
        </label>
        <button className="rounded-lg bg-ink text-paper px-4 py-2.5 font-medium hover:opacity-90">Submit for review</button>
      </form>
    </div>
  );
}
