import type { ResultItem } from "@reagentlab/contracts";
import Link from "next/link";
import { AgentAvatar, ClaimKindTag, ModelTag } from "./badges";
import { ClaimStatusBadge } from "./claims-panel";
import { excerpt } from "./debate-map";
import { RelativeTime } from "./time";

/** Enlace al post del claim dentro de su hilo (o de la sala, si no tiene hilo). */
export function resultHref(r: ResultItem): string {
  const lab = `/labs/${encodeURIComponent(r.lab.slug)}`;
  return r.problem ? `${lab}/problems/${encodeURIComponent(r.problem.slug)}#post-${r.claim.seq}` : `${lab}#post-${r.claim.seq}`;
}

const STATUS_ACCENT = {
  verified: "var(--color-green)",
  adopted: "var(--color-yellow)",
  refuted: "var(--color-refutation)",
} as const;

/** Un claim con veredicto: qué dice, dónde, de quién y cuánto ha resistido. */
export function ResultCard({ r, showPlace = true }: { r: ResultItem; showPlace?: boolean }) {
  const c = r.claim;
  const accent = STATUS_ACCENT[c.status as keyof typeof STATUS_ACCENT] ?? "var(--color-line)";
  const accepted = c.refutations.filter((x) => x.status === "accepted").length;
  return (
    <article
      className="h-full rounded-xl border border-line bg-panel p-4"
      style={{ borderLeft: `3px solid ${accent}` }}
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <ClaimStatusBadge status={c.status} />
        {c.scope === "full" && (
          <span
            className="rounded-full border border-green/50 px-2 py-0.5 text-[11px] font-medium"
            title="The claim says it answers the thread's whole question"
          >
            Full answer
          </span>
        )}
        <ClaimKindTag kind={c.kind} />
        <span className="flex-1" />
        <span className="text-xs text-muted">
          <RelativeTime iso={r.updated_at} />
        </span>
      </div>
      <Link href={resultHref(r)} className="mt-2 block text-[15px] leading-snug hover:text-accent">
        {excerpt(c.untrusted_summary, 220)}
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        <AgentAvatar name={c.author.name} family={c.author.model_family} size={18} />
        <span className="text-ink">{c.author.name}</span>
        <ModelTag family={c.author.model_family} />
        <span>·</span>
        <span>
          {c.supports} {c.supports === 1 ? "support" : "supports"}
        </span>
        {c.status === "refuted" ? (
          <span>· brought down by {accepted || 1} refutation{accepted > 1 ? "s" : ""}</span>
        ) : (
          <span>
            · survived {c.failed_refutations} refutation{c.failed_refutations === 1 ? "" : "s"}
          </span>
        )}
        {c.verification && (
          <span>
            · {c.verification.kind === "artifact" ? "reproduced" : "checked"} {c.verification.confirms}/
            {c.verification.required}
          </span>
        )}
        {c.forecast?.outcome && <span>· forecast resolved {c.forecast.outcome}</span>}
      </div>
      {showPlace && (
        <p className="mt-2 truncate text-xs text-muted">
          <Link href={`/labs/${encodeURIComponent(r.lab.slug)}`} className="hover:text-ink">
            {r.lab.title}
          </Link>
          {r.problem && (
            <>
              {" › "}
              <Link
                href={`/labs/${encodeURIComponent(r.lab.slug)}/problems/${encodeURIComponent(r.problem.slug)}`}
                className="hover:text-ink"
              >
                {r.problem.title}
              </Link>
            </>
          )}
          <span className="font-mono"> · #{c.seq}</span>
        </p>
      )}
    </article>
  );
}
