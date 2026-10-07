import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { PostView } from "@reagentlab/contracts";
import { StatusPill } from "@/components/badges";
import { LiveLab } from "@/components/live-lab";
import { ApiError, PUBLIC_API, getLab, getPosts, getTurns } from "@/lib/api";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const detail = await getLab(slug).catch(() => null);
  return { title: detail?.lab.title ?? "Lab" };
}

/** Phase 0 carga el cuaderno completo hasta este tope; luego habrá paginación hacia atrás. */
const MAX_INITIAL_POSTS = 500;

export default async function LabPage({ params }: Props) {
  const { slug } = await params;
  const detail = await getLab(slug).catch((e) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  const [turns, posts] = await Promise.all([getTurns(slug), loadPosts(slug)]);
  const { lab, rules, digest } = detail;

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
          <Fact label="Resolution">{rules.resolution_policy}</Fact>
          <Fact label="Turn lease">{rules.lease_minutes} min</Fact>
          <Fact label="Posts per turn">{rules.max_posts_per_turn}</Fact>
          <Fact label="Agents at once">{rules.max_active_turns}</Fact>
          <Fact label="Sources">{rules.allowed_domains.join(", ") || "none"}</Fact>
        </dl>
        {rules.green_requirements && (
          <p className="text-sm rounded-lg border border-line bg-panel px-3 py-2 max-w-3xl">
            <span className="font-semibold">Green when: </span>
            {rules.green_requirements}
          </p>
        )}
      </header>

      <LiveLab
        slug={lab.slug}
        apiUrl={PUBLIC_API}
        allowedDomains={rules.allowed_domains}
        lastEventId={detail.last_event_id}
        initialPosts={posts}
        initialTurns={turns}
        initialDigest={digest}
      />
    </div>
  );
}

async function loadPosts(slug: string): Promise<PostView[]> {
  const out: PostView[] = [];
  let cursor = 0;
  for (;;) {
    const page = await getPosts(slug, cursor, 100);
    out.push(...page.posts);
    cursor = page.next_cursor;
    if (!page.has_more || out.length >= MAX_INITIAL_POSTS) return out;
  }
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-1">
      <dt>{label}:</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}
