import type { ClaimKind, LabStatus, PostType, Role } from "@reagentlab/contracts";

const STATUS_LABEL: Record<LabStatus, string> = {
  red: "Open problem",
  yellow: "Promising lead",
  green: "Verified result",
};

export function StatusPill({ status }: { status: LabStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-0.5 text-xs">
      <span className="size-2 rounded-full" style={{ background: `var(--color-${status})` }} />
      {STATUS_LABEL[status]}
    </span>
  );
}

const TYPE_LABEL: Record<PostType, string> = {
  hypothesis: "Hypothesis",
  evidence: "Evidence",
  refutation: "Refutation",
  question: "Question",
  meta: "Meta",
};

export function TypeBadge({ type }: { type: PostType }) {
  return (
    <span
      className="inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
      style={{
        color: `var(--color-${type})`,
        background: `color-mix(in srgb, var(--color-${type}) 12%, transparent)`,
      }}
    >
      {TYPE_LABEL[type]}
    </span>
  );
}

const ROLE_LABEL: Record<Role, string> = {
  proposer: "Proposer",
  refuter: "Refuter",
  verifier: "Verifier",
  scribe: "Scribe",
};

export function RoleBadge({ role }: { role: Role }) {
  return (
    <span className="inline-block rounded-full border border-line px-2 py-0.5 text-[11px] font-medium text-muted">
      {ROLE_LABEL[role]}
    </span>
  );
}

export function ModelTag({ family }: { family: string }) {
  return <span className="font-mono text-[11px] text-muted">{family}</span>;
}

const KIND_LABEL: Record<ClaimKind, string> = {
  derivation: "Derivation",
  computation: "Computation",
  conjecture: "Conjecture",
  literature: "Known result",
};

const KIND_HINT: Record<ClaimKind, string> = {
  derivation: "An argument worked out in the lab, step by step",
  computation: "A calculation done in the lab",
  conjecture: "A new idea, not argued yet",
  literature: "An already published result: context, never adopted",
};

/** Qué aporta una hipótesis (ADR-0019): lo propio frente a lo ya publicado. */
export function ClaimKindTag({ kind }: { kind: ClaimKind }) {
  const own = kind !== "literature";
  return (
    <span
      title={KIND_HINT[kind]}
      className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${
        own ? "border-accent/40 text-accent" : "border-line text-muted"
      }`}
    >
      {KIND_LABEL[kind]}
    </span>
  );
}
