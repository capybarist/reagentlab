import type { ClaimStatus, ClaimView, PollView } from "@reagentlab/contracts";
import { ClaimKindTag } from "./badges";
import { RelativeTime } from "./time";

const CLAIM_LABEL: Record<ClaimStatus, string> = {
  open: "Open",
  supported: "Supported",
  adopted: "Adopted",
  verified: "Verified",
  refuted: "Refuted",
};

const CLAIM_COLOR: Record<ClaimStatus, string> = {
  open: "var(--color-muted)",
  supported: "var(--color-evidence)",
  adopted: "var(--color-yellow)",
  verified: "var(--color-green)",
  refuted: "var(--color-refutation)",
};

export function ClaimStatusBadge({ status }: { status: ClaimStatus }) {
  return (
    <span
      className="inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
      style={{ color: CLAIM_COLOR[status], background: `color-mix(in srgb, ${CLAIM_COLOR[status]} 12%, transparent)` }}
    >
      {CLAIM_LABEL[status]}
    </span>
  );
}

/** Claims de la sala: cada hipótesis, su estado y cuánto ha resistido. */
export function ClaimsPanel({ claims }: { claims: ClaimView[] }) {
  // Lo ya publicado va aparte: es contexto, no avance de la sala (ADR-0019).
  const known = claims.filter((c) => c.kind === "literature" && c.status !== "refuted");
  const live = claims.filter((c) => c.kind !== "literature" && c.status !== "refuted");
  const refuted = claims.filter((c) => c.status === "refuted").length;
  return (
    <section className="rounded-xl border border-line bg-panel p-4">
      <h2 className="text-sm font-semibold">Claims</h2>
      {live.length === 0 ? (
        <p className="mt-3 text-sm text-muted">
          No claims of the lab&apos;s own yet. Derivations, computations and conjectures appear here.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {live.map((c) => (
            <li key={c.seq} className="text-sm">
              <div className="flex items-center gap-2">
                <a href={`#post-${c.seq}`} className="font-mono text-xs text-muted hover:text-ink">
                  #{c.seq}
                </a>
                <ClaimStatusBadge status={c.status} />
                <ClaimKindTag kind={c.kind} />
                <span className="truncate text-xs text-muted">{c.author.name}</span>
              </div>
              <p className="mt-1 text-xs text-muted">
                {c.supports} support{c.supports === 1 ? "" : "s"} · survived {c.failed_refutations} refutation
                {c.failed_refutations === 1 ? "" : "s"}
                {c.refutations.some((r) => r.status === "pending" || r.status === "ruled" || r.status === "disputed") &&
                  " · under refutation"}
              </p>
            </li>
          ))}
        </ul>
      )}
      {known.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Known results</h3>
          <ul className="mt-2 space-y-1.5">
            {known.map((c) => (
              <li key={c.seq} className="text-xs text-muted flex gap-2">
                <a href={`#post-${c.seq}`} className="font-mono hover:text-ink">
                  #{c.seq}
                </a>
                <span className="truncate">{c.untrusted_summary}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {refuted > 0 && (
        <p className="mt-3 text-xs text-muted">
          {refuted} refuted claim{refuted === 1 ? "" : "s"} (see the notebook).
        </p>
      )}
    </section>
  );
}

/** Polls a ciegas: los abiertos sin recuento; los cerrados con su resultado. */
export function PollsPanel({ polls }: { polls: PollView[] }) {
  if (polls.length === 0) return null;
  const open = polls.filter((p) => p.status === "open");
  const closed = polls.filter((p) => p.status === "closed").slice(0, 5);
  return (
    <section className="rounded-xl border border-line bg-panel p-4">
      <h2 className="text-sm font-semibold">Polls</h2>
      <ul className="mt-3 space-y-3">
        {open.map((p) => (
          <li key={p.id} className="text-sm">
            <PollTitle poll={p} />
            <p className="mt-1 text-xs text-muted">
              Blind vote · closes <RelativeTime iso={p.closes_at} />
            </p>
          </li>
        ))}
        {closed.map((p) => (
          <li key={p.id} className="text-sm">
            <PollTitle poll={p} />
            {p.result && (
              <p className="mt-1 text-xs text-muted">
                {p.result.outcome === "no_quorum"
                  ? `No quorum (${p.result.families} model famil${p.result.families === 1 ? "y" : "ies"})`
                  : `${p.result.outcome === "yes" ? "Yes" : "No"} · ${p.result.weighted.yes} vs ${p.result.weighted.no}`}{" "}
                · {p.result.voters} vote{p.result.voters === 1 ? "" : "s"}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function PollTitle({ poll }: { poll: PollView }) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-medium">{poll.kind === "adopt_claim" ? "Adopt" : "Dispute on"}</span>
      <a href={`#post-${poll.refutation_seq ?? poll.claim.seq}`} className="font-mono text-xs text-muted hover:text-ink">
        #{poll.refutation_seq ?? poll.claim.seq}
      </a>
      {poll.status === "open" && <span className="text-[11px] text-accent font-semibold uppercase">open</span>}
    </div>
  );
}
