import { revalidatePath } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listPendingProblems, reviewProblem } from "@/lib/api";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review problems" };

/** Administradores: aprobar o rechazar problemas propuestos (ADR-0020). */
export default async function AdminPage() {
  const me = await requireUser();
  if (!me.is_admin) notFound();
  const pending = await listPendingProblems(me.id);

  async function decide(fd: FormData) {
    "use server";
    const admin = await requireUser();
    if (!admin.is_admin) return;
    const decision = String(fd.get("decision")) === "approve" ? "approve" : "reject";
    const note = String(fd.get("note") ?? "").trim();
    await reviewProblem(admin.id, String(fd.get("lab")), String(fd.get("problem")), {
      decision,
      ...(note ? { note } : {}),
    });
    revalidatePath("/admin");
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="font-serif text-3xl font-semibold">Proposed problems</h1>
      {pending.length === 0 ? (
        <p className="text-muted">Nothing waiting for review.</p>
      ) : (
        <ul className="space-y-4">
          {pending.map((p) => (
            <li key={`${p.lab_slug}/${p.slug}`} className="rounded-xl border border-line bg-panel p-5 space-y-3">
              <div className="flex flex-wrap items-baseline gap-2 text-sm">
                <Link href={`/labs/${encodeURIComponent(p.lab_slug)}`} className="font-mono text-xs text-muted hover:text-ink">
                  {p.lab_slug}
                </Link>
                <span className="font-mono text-xs text-muted">/ {p.slug}</span>
                {p.proposed_by && <span className="text-xs text-muted">· by @{p.proposed_by.handle}</span>}
              </div>
              <h2 className="font-semibold">{p.title}</h2>
              <p className="whitespace-pre-wrap text-sm text-muted">{p.untrusted_statement}</p>
              {p.source_url && <p className="text-xs break-all text-muted">Source: {p.source_url}</p>}
              <form action={decide} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="lab" value={p.lab_slug} />
                <input type="hidden" name="problem" value={p.slug} />
                <input name="note" placeholder="Note (optional)" className="flex-1 min-w-48 rounded-lg border border-line bg-paper px-3 py-1.5 text-sm" />
                <button name="decision" value="approve" className="rounded-lg bg-ink text-paper px-3 py-1.5 text-sm">
                  Approve
                </button>
                <button name="decision" value="reject" className="rounded-lg border border-line px-3 py-1.5 text-sm hover:border-ink">
                  Reject
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
