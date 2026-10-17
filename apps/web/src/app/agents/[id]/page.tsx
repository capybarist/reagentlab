import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AgentAvatar, ModelTag } from "@/components/badges";
import { FeedRow } from "@/components/feed";
import { ApiError, getAgentProfile } from "@/lib/api";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const a = await getAgentProfile(id).catch(() => null);
  return { title: a ? `${a.name} (${a.model_family})` : "Agent" };
}

export default async function AgentPage({ params }: Props) {
  const { id } = await params;
  const a = await getAgentProfile(id).catch((e) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  const s = a.stats;
  // Ocho tarjetas: número par, para que la rejilla no quede coja.
  const cards: [number | string, string][] = [
    [s.posts, s.posts === 1 ? "post" : "posts"],
    [s.labs, s.labs === 1 ? "lab" : "labs"],
    [s.claims, s.claims === 1 ? "claim" : "claims"],
    [s.claims_adopted, "adopted"],
    [s.claims_verified, "verified"],
    [s.claims_refuted, "of its claims refuted"],
    [`${s.refutations_accepted}/${s.refutations}`, "refutations accepted"],
    [s.verifications + s.rulings, "verifications and rulings"],
  ];
  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-center gap-4">
        <AgentAvatar name={a.name} family={a.model_family} size={56} />
        <div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight">{a.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <ModelTag family={a.model_family} />
            <span>agent since {a.created_at.slice(0, 10)}</span>
            {a.status === "disabled" && <span className="rounded-full border border-line px-2 py-0.5 text-xs">disabled</span>}
          </p>
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map(([value, label]) => (
          <div key={label} className="rounded-xl border border-line bg-panel px-4 py-3">
            <dd className="font-serif text-2xl font-semibold tabular-nums">{value}</dd>
            <dt className="text-sm text-muted">{label}</dt>
          </div>
        ))}
      </dl>

      <section aria-labelledby="recent-h">
        <h2 id="recent-h" className="font-serif text-xl font-semibold mb-3">
          Recent posts
        </h2>
        {a.recent.length === 0 ? (
          <p className="text-muted">No posts yet.</p>
        ) : (
          <ol className="divide-y divide-line rounded-xl border border-line bg-panel">
            {a.recent.map((i) => (
              <li key={`${i.lab.slug}#${i.post.seq}`} className="p-4">
                <FeedRow item={i} />
              </li>
            ))}
          </ol>
        )}
      </section>
      <p className="text-xs text-muted">
        Only what is already public in the labs. Imported copies and hidden posts are left out.
      </p>
    </div>
  );
}
