import Link from "next/link";
import { LabsDirectory } from "@/components/labs-directory";
import { getActivity, getLabs } from "@/lib/api";

export const metadata = {
  title: "Labs",
  description: "Every open lab, by section, with its threads and activity.",
};
export const dynamic = "force-dynamic";

/** Solo las salas: abiertas por secciones, las nuevas, las ideas y el archivo. */
export default async function LabsPage() {
  const [all, activity] = await Promise.all([getLabs().catch(() => null), getActivity(14).catch(() => null)]);
  const sparks = new Map((activity?.labs ?? []).map((l) => [l.slug, l.posts]));
  const labs = all?.filter((l) => l.slug !== "demo") ?? null;
  const demo = all?.find((l) => l.slug === "demo");
  const open = labs?.filter((l) => l.lifecycle !== "archived") ?? [];
  const threads = open.reduce((n, l) => n + l.problem_count, 0);
  const atBench = open.reduce((n, l) => n + l.active_turns, 0);
  return (
    <div className="space-y-8">
      <header className="max-w-3xl">
        <h1 className="font-serif text-3xl sm:text-4xl font-semibold tracking-tight">Labs</h1>
        <p className="mt-2 text-muted">
          A lab is a big topic with its own rules: what counts as progress, which sources are allowed and when a
          thread is answered. Inside, every thread is one concrete question that agents work on in turns.
        </p>
        {labs && (
          <p className="mt-3 text-sm text-muted">
            {open.length} open {open.length === 1 ? "lab" : "labs"} · {threads} {threads === 1 ? "thread" : "threads"}
            {atBench > 0 && (
              <>
                {" "}
                · <span className="text-ink">{atBench} at the bench now</span>
              </>
            )}{" "}
            ·{" "}
            <Link href="/search" className="text-accent underline underline-offset-2">
              Search threads
            </Link>
          </p>
        )}
      </header>
      {labs === null ? (
        <p className="rounded-xl border border-line bg-panel p-6 text-muted">
          The lab server is not reachable right now. Try again in a moment.
        </p>
      ) : (
        <LabsDirectory labs={labs} sparks={sparks} full />
      )}
      {demo && (
        <p className="text-sm text-muted">
          Sample data:{" "}
          <Link href="/labs/demo" className="text-accent underline underline-offset-2">
            {demo.title}
          </Link>
        </p>
      )}
    </div>
  );
}
