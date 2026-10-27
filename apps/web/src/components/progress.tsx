import type { ClaimView, LabStatus } from "@reagentlab/contracts";

/**
 * Hasta dónde ha llegado un hilo (ADR-0038: cada hilo es una pregunta que puede concluir).
 * Se mide por su mejor claim propio: los resultados ya publicados no cuentan como avance.
 */
export const STAGES = [
  { label: "Claim made", hint: "Someone put forward a claim of their own" },
  { label: "Supported", hint: "An agent of another person brought evidence for it" },
  { label: "Under check", hint: "Another person's agent confirmed it once, or a refutation of it failed" },
  {
    label: "Verified result",
    hint: "Agents of other people reproduced or checked a claim, with no refutation open (or a blind vote adopted one that cannot be checked)",
  },
  { label: "Answered", hint: "A verified claim answers the whole question of the thread" },
] as const;

/**
 * 0 = sin claims; 1–4 = la etapa de STAGES alcanzada por el mejor claim; 5 solo si el hilo está en verde
 * (ADR-0039/0047: un parcial verificado no responde el hilo). Verificar no pasa por adoptar (ADR-0044),
 * así que verificado y adoptado son la misma etapa.
 */
export function stageFromClaims(claims: ClaimView[], status?: LabStatus): number {
  if (status === "green") return 5;
  let best = 0;
  for (const c of claims) {
    if (c.kind === "literature" || c.status === "refuted") continue;
    const s =
      c.status === "verified" || c.status === "adopted"
        ? 4
        : c.status === "supported"
            ? c.failed_refutations > 0 || (c.verification?.confirms ?? 0) > 0
              ? 3
              : 2
            : 1;
    best = Math.max(best, s);
  }
  return best;
}

/** En las tarjetas solo se sabe el estado del hilo y sus claims vivos. */
export function stageFromSummary(status: LabStatus, openClaims: number): number {
  return status === "green" ? 5 : status === "yellow" ? 4 : openClaims > 0 ? 1 : 0;
}

const stageColor = (stage: number) =>
  stage >= 5 ? "var(--color-green)" : stage >= 4 ? "var(--color-yellow)" : stage >= 2 ? "var(--color-evidence)" : "var(--color-hypothesis)";

export function ThreadProgress({ stage, compact = false }: { stage: number; compact?: boolean }) {
  const label = stage === 0 ? "No claims yet" : STAGES[stage - 1]!.label;
  const color = stageColor(stage);
  return (
    <div className={compact ? "" : "max-w-3xl"} aria-label={`Progress: ${label}`}>
      <div className="flex gap-1" role="presentation">
        {STAGES.map((s, i) => (
          <span
            key={s.label}
            title={s.hint}
            className={`${compact ? "h-1" : "h-1.5"} flex-1 rounded-full`}
            style={{ background: i < stage ? color : "var(--color-line)" }}
          />
        ))}
      </div>
      {compact ? (
        <p className="mt-1 text-[11px] text-muted">{label}</p>
      ) : (
        <ol className="mt-1.5 hidden sm:flex gap-1 text-[11px] text-muted">
          {STAGES.map((s, i) => (
            <li key={s.label} className={`flex-1 ${i < stage ? "text-ink font-medium" : ""}`} title={s.hint}>
              {s.label}
            </li>
          ))}
        </ol>
      )}
      {!compact && <p className="mt-1 text-xs text-muted sm:hidden">{label}</p>}
    </div>
  );
}
