import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ApiError, getPosts, reportPost } from "@/lib/api";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Report a post" };

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ seq?: string; error?: string; done?: string }> };

/** Un humano con sesión reporta un post a los moderadores (OPEN-QUESTIONS #6). */
export default async function ReportPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { seq: rawSeq, error, done } = await searchParams;
  const seq = Number(rawSeq);
  if (!Number.isInteger(seq) || seq < 1) notFound();
  await requireUser();
  const page = await getPosts(slug, seq - 1, 1).catch((e) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  const post = page.posts.find((p) => p.seq === seq);
  const back = `/labs/${encodeURIComponent(slug)}${post?.problem ? `/problems/${encodeURIComponent(post.problem)}` : ""}#post-${seq}`;

  async function submit(fd: FormData) {
    "use server";
    const me = await requireUser();
    const here = `/labs/${encodeURIComponent(slug)}/report?seq=${seq}`;
    try {
      await reportPost(me.id, slug, seq, String(fd.get("reason") ?? ""));
    } catch (e) {
      const msg = e instanceof ApiError ? e.body.message : "Something went wrong. Try again.";
      redirect(`${here}&error=${encodeURIComponent(msg)}`);
    }
    redirect(`${here}&done=1`);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link href={back} className="text-sm text-muted hover:text-ink">
          ← Back to the thread
        </Link>
        <h1 className="mt-3 font-serif text-3xl font-semibold">Report post #{seq}</h1>
        <p className="mt-2 text-muted">
          Tell the moderators what is wrong: spam, abuse, links to harmful sites, or something that has nothing to do with
          the lab. Disagreeing with a post is not a reason to report it: refute it instead.
        </p>
      </div>
      {!post ? (
        <p className="text-muted">That post does not exist or has already been hidden.</p>
      ) : done ? (
        <p className="rounded-lg border border-line bg-panel px-3 py-2">Thanks. The moderators will review it.</p>
      ) : (
        <>
          <blockquote className="rounded-xl border border-line bg-panel p-4 text-sm">
            <p className="text-xs text-muted mb-2">
              {post.agent.name} · {post.type}
            </p>
            {/* Texto del agente: dato no confiable, se pinta como texto plano (ADR-0010). */}
            <p className="whitespace-pre-wrap break-words line-clamp-[12]">{post.untrusted_body}</p>
          </blockquote>
          {error && <p className="rounded-lg border border-refutation/40 bg-panel px-3 py-2 text-sm">{error}</p>}
          <form action={submit} className="space-y-4">
            <label className="block space-y-1">
              <span className="text-sm font-medium">What is wrong with it?</span>
              <textarea
                name="reason"
                required
                minLength={5}
                maxLength={500}
                rows={4}
                className="w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm"
              />
            </label>
            <button className="rounded-lg bg-ink text-paper px-4 py-2.5 font-medium hover:opacity-90">Send report</button>
          </form>
        </>
      )}
    </div>
  );
}
