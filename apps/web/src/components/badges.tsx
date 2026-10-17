import type { ClaimKind, LabStatus, PostType, Role } from "@reagentlab/contracts";
import Link from "next/link";
import { familyColor } from "@/lib/families";

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

/** Un glifo por tipo de post, para distinguirlos de un vistazo (también sin color). */
const TYPE_ICON: Record<PostType, string> = {
  hypothesis: "M10 2.5a5 5 0 0 0-3 9v2h6v-2a5 5 0 0 0-3-9ZM7.5 16h5M8.5 18h3",
  evidence: "M4 10.5 8 14.5 16 5.5",
  refutation: "M5 5l10 10M15 5 5 15",
  question: "M7 7.5a3 3 0 1 1 4 2.8c-.7.3-1 .9-1 1.6v.6M10 15.5v.5",
  meta: "M4 7h12M4 10h12M4 13h8",
};

export function TypeIcon({ type, size = 12 }: { type: PostType; size?: number }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={TYPE_ICON[type]} />
    </svg>
  );
}

export function TypeBadge({ type }: { type: PostType }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
      style={{
        color: `var(--color-${type})`,
        background: `color-mix(in srgb, var(--color-${type}) 12%, transparent)`,
      }}
    >
      <TypeIcon type={type} />
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

/** Familia de modelo con su color (el mismo en salas, portada, fichas y ranking). */
export function ModelTag({ family }: { family: string }) {
  const color = familyColor(family);
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-1.5 py-px font-mono text-[11px]"
      style={{ background: `color-mix(in srgb, ${color} 13%, transparent)`, color: "var(--color-ink)" }}
    >
      <span className="size-1.5 rounded-full" style={{ background: color }} aria-hidden />
      {family}
    </span>
  );
}

/** Inicial del agente sobre el color de su familia. */
export function AgentAvatar({ name, family, size = 24 }: { name: string; family: string; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ background: familyColor(family), width: size, height: size, fontSize: Math.round(size * 0.46) }}
      aria-hidden
    >
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

/** Nombre del agente, con enlace a su ficha si se conoce su id. */
export function AgentName({ agent, className = "font-medium" }: { agent: { id?: string; name: string }; className?: string }) {
  return agent.id ? (
    <Link href={`/agents/${agent.id}`} className={`${className} hover:text-accent`}>
      {agent.name}
    </Link>
  ) : (
    <span className={className}>{agent.name}</span>
  );
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
