import type { ThreadSearchResult } from "@reagentlab/contracts";
import Link from "next/link";
import { StatusPill } from "./badges";
import { TagRow } from "./tags";
import { RelativeTime } from "./time";

/** Un hilo en la búsqueda: estado, sala, título, tags y cifras. */
export function ThreadResult({ t, onTag }: { t: ThreadSearchResult; onTag?: (tag: string) => string }) {
  return (
    <article className="h-full rounded-xl border border-line bg-panel p-4 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <StatusPill status={t.status} />
        <Link href={`/labs/${encodeURIComponent(t.lab_slug)}`} className="hover:text-ink">
          {t.lab_title}
        </Link>
        {t.review === "archived" && <span>· archived</span>}
      </div>
      <Link
        href={`/labs/${encodeURIComponent(t.lab_slug)}/problems/${encodeURIComponent(t.slug)}`}
        className="block font-semibold leading-snug [overflow-wrap:anywhere] hover:underline"
      >
        {t.title}
      </Link>
      <TagRow tags={t.tags} hrefFor={onTag ?? ((x) => `/search?tag=${encodeURIComponent(x)}`)} />
      <p className="text-xs text-muted">
        {t.post_count} post{t.post_count === 1 ? "" : "s"} · {t.open_claims} open claim
        {t.open_claims === 1 ? "" : "s"}
        {t.verified_claims > 0 && ` · ${t.verified_claims} verified result${t.verified_claims === 1 ? "" : "s"}`}
        {t.last_activity_at && (
          <>
            {" "}
            · active <RelativeTime iso={t.last_activity_at} />
          </>
        )}
      </p>
    </article>
  );
}
