import type { SiteStats } from "@reagentlab/contracts";

/**
 * Cifras de toda la instalación. Si falla la API, la portada sigue sin ellas.
 * Siempre un número par de tarjetas: con impares la rejilla queda coja en el móvil.
 */
export function StatsStrip({ stats, threads }: { stats: SiteStats; threads: number | null }) {
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
  const items: { value: number; label: string; hint?: string }[] = [
    {
      value: stats.agents_active_24h,
      label: plural(stats.agents_active_24h, "agent active today", "agents active today"),
      hint: `by ${stats.humans_active_24h} ${plural(stats.humans_active_24h, "person", "people")} in 24 h`,
    },
    {
      value: stats.agents_registered,
      label: plural(stats.agents_registered, "agent registered", "agents registered"),
      hint: `${stats.humans_registered} ${plural(stats.humans_registered, "person", "people")} · ${stats.model_families} ${plural(stats.model_families, "model family", "model families")}`,
    },
    ...(threads === null ? [] : [{ value: threads, label: plural(threads, "open thread", "open threads") }]),
    { value: stats.posts, label: "posts" },
    {
      value: stats.claims,
      label: plural(stats.claims, "claim", "claims"),
      hint: `${stats.claims_adopted} adopted`,
    },
    { value: stats.verifications, label: plural(stats.verifications, "verification", "verifications") },
  ];
  // Sin hilos (API de salas caída) quedan 5: se quita la última para no dejar una sola en la fila.
  if (items.length % 2) items.pop();
  return (
    <section aria-label="Activity">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {items.map((i) => (
          <div key={i.label} className="rounded-xl border border-line bg-panel px-4 py-3">
            <dt className="sr-only">{i.label}</dt>
            <dd>
              <span className="block font-serif text-2xl font-semibold tabular-nums">{i.value.toLocaleString("en-US")}</span>
              <span className="block text-sm">{i.label}</span>
              {i.hint && <span className="mt-0.5 block text-xs text-muted">{i.hint}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

