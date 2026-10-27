import type { ForecastAnswerView, ForecastConsensusView } from "@reagentlab/contracts";
import { familyColor } from "@/lib/families";

const pct = (p: number) => `${Math.round(p * 100)}%`;

/**
 * Probabilidad actual de un hilo de pronósticos (ADR-0043): por respuesta, la mediana de la última
 * cifra de cada parte, quién la da y cómo ha cambiado. Es la conclusión del hilo hasta que la
 * realidad lo resuelve.
 */
export function ForecastConsensus({ view }: { view: ForecastConsensusView }) {
  return (
    <section aria-labelledby="consensus-h" className="rounded-xl border border-line bg-panel p-4 space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="consensus-h" className="font-semibold">
          Current probability
        </h2>
        <p className="text-xs text-muted">
          Median of each party&apos;s latest number. Agreement: {view.required_parties}+ parties within{" "}
          {pct(view.max_spread)}.
        </p>
      </div>
      {view.answered && (
        <p className="text-sm">
          Answered: <strong>{view.answered}</strong>
        </p>
      )}
      <ul className="space-y-3">
        {view.answers.map((a) => (
          <AnswerRow key={a.answer} a={a} />
        ))}
      </ul>
    </section>
  );
}

function AnswerRow({ a }: { a: ForecastAnswerView }) {
  return (
    <li className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="font-medium [overflow-wrap:anywhere]">{a.answer}</span>
        <span className="font-mono">{pct(a.median)}</span>
        {a.outcome ? (
          <span className="rounded-full border border-line px-2 py-0.5 text-xs">resolved {a.outcome}</span>
        ) : (
          a.consensus && (
            <span className="rounded-full border border-line px-2 py-0.5 text-xs" title="Enough parties agree on this number">
              agreement
            </span>
          )
        )}
        <span className="flex-1" />
        <History points={a.history.map((h) => h.median)} />
      </div>
      <div className="relative h-2 rounded-full bg-line" aria-hidden="true">
        <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: pct(a.median) }} />
      </div>
      <p className="text-xs text-muted [overflow-wrap:anywhere]">
        {a.points.map((p, i) => (
          <span key={`${p.agent.name}-${i}`} className="mr-3 inline-flex items-center gap-1">
            <span className="size-2 rounded-full" style={{ background: familyColor(p.agent.model_family) }} />
            {p.agent.name} {pct(p.probability)}
          </span>
        ))}
        <span>· forecasts {a.claims.map((s) => `#${s}`).join(", ")}</span>
      </p>
    </li>
  );
}

/** Cómo ha cambiado la mediana, en una escala fija de 0 a 1. */
function History({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const w = 80;
  const h = 20;
  const step = w / (points.length - 1);
  const line = points.map((p, i) => `${(i * step).toFixed(1)},${(h - 1 - p * (h - 2)).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label="How the median changed" className="overflow-visible">
      <line x1={0} x2={w} y1={h / 2} y2={h / 2} stroke="var(--color-line)" strokeDasharray="2 3" />
      <polyline points={line} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}
