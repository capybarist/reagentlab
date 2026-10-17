import type { ActivityView, PostType } from "@reagentlab/contracts";

/** Orden de apilado: lo que hace avanzar un hilo abajo, el resto encima. */
const STACK: PostType[] = ["hypothesis", "evidence", "refutation", "question", "meta"];
const TYPE_NAME: Record<PostType, string> = {
  hypothesis: "Hypotheses",
  evidence: "Evidence",
  refutation: "Refutations",
  question: "Questions",
  meta: "Meta",
};

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** "Oct 7" a partir de "2026-10-07", sin depender de la zona horaria del navegador. */
export function shortDay(day: string): string {
  const [, m, d] = day.split("-").map(Number);
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][(m ?? 1) - 1]} ${d}`;
}

/** Línea pequeña con área, para tarjetas. Sin ejes: solo la forma de la actividad. */
export function Sparkline({
  values,
  color = "var(--color-accent)",
  width = 120,
  height = 28,
  label,
}: {
  values: number[];
  color?: string;
  width?: number;
  height?: number;
  label?: string;
}) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const step = width / (values.length - 1);
  const pts = values.map((v, i) => [i * step, height - 2 - (v / max) * (height - 4)] as const);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `0,${height} ${line} ${width},${height}`;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={label ?? `${sum(values)} posts`}
      className="overflow-visible"
    >
      <polygon points={area} fill={color} opacity={0.12} />
      <polyline points={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts.at(-1)![0]} cy={pts.at(-1)![1]} r={2} fill={color} />
    </svg>
  );
}

/** Posts por día de toda la instalación, apilados por tipo. En HTML para que la altura no crezca con el ancho. */
export function ActivityChart({ activity, title = "Posts per day" }: { activity: ActivityView; title?: string }) {
  const n = activity.days.length;
  const max = Math.max(1, ...activity.total);
  const total = sum(activity.total);
  const activeDays = activity.total.filter((x) => x > 0).length;
  const busiest = activity.total.indexOf(Math.max(...activity.total));
  const types = STACK.filter((t) => sum(activity.by_type[t] ?? []) > 0);
  return (
    <figure className="rounded-xl border border-line bg-panel p-4">
      <figcaption className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-xs text-muted">
          {total.toLocaleString("en-US")} posts in the last {n} days · {activeDays} active{" "}
          {activeDays === 1 ? "day" : "days"}
          {total > 0 && (
            <>
              {" "}
              · busiest {shortDay(activity.days[busiest]!)} ({activity.total[busiest]})
            </>
          )}
        </span>
      </figcaption>
      <div className="relative mt-3 h-28 sm:h-32" role="img" aria-label={`${title}: ${total} posts`}>
        <div className="absolute inset-x-0 top-0 border-t border-dashed border-line" aria-hidden>
          <span className="absolute right-0 -top-4 text-[10px] text-muted">{max}</span>
        </div>
        <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-line" aria-hidden />
        <div className="relative flex h-full items-end gap-px sm:gap-0.5 border-b border-line">
          {activity.days.map((day, i) => (
            <div
              key={day}
              className="group flex h-full flex-1 flex-col-reverse"
              title={`${shortDay(day)}: ${activity.total[i]} posts${types
                .filter((t) => activity.by_type[t]![i])
                .map((t) => `\n${TYPE_NAME[t]}: ${activity.by_type[t]![i]}`)
                .join("")}`}
            >
              {STACK.map((t) => {
                const v = activity.by_type[t]?.[i] ?? 0;
                return v ? (
                  <span
                    key={t}
                    className="block w-full first:rounded-b-none last:rounded-t-sm group-hover:opacity-80"
                    style={{ height: `${(v / max) * 100}%`, background: `var(--color-${t})` }}
                  />
                ) : null;
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted" aria-hidden>
        <span>{shortDay(activity.days[0]!)}</span>
        <span>{shortDay(activity.days[Math.floor((n - 1) / 2)]!)}</span>
        <span>today</span>
      </div>
      {types.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {types.map((t) => (
            <li key={t} className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-sm" style={{ background: `var(--color-${t})` }} aria-hidden />
              {TYPE_NAME[t]} {sum(activity.by_type[t]!).toLocaleString("en-US")}
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

/** Barra horizontal con un tramo por categoría, para repartos (tipos de post, familias...). */
export function MixBar({ parts, label }: { parts: { key: string; value: number; color: string; name: string }[]; label: string }) {
  const total = sum(parts.map((p) => p.value));
  if (!total) return null;
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-line" role="img" aria-label={label}>
        {parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <span
              key={p.key}
              title={`${p.name}: ${p.value} (${Math.round((p.value / total) * 100)}%)`}
              style={{ width: `${(p.value / total) * 100}%`, background: p.color }}
            />
          ))}
      </div>
    </div>
  );
}
