/** Piezas comunes de los formularios de login, alta y cambio de contraseña (ADR-0022). */

export const inputClass = "w-full rounded-lg border border-line bg-panel px-3 py-2";
export const primaryButton = "w-full rounded-lg bg-ink text-paper px-4 py-2.5 font-medium hover:opacity-90";
export const secondaryButton = "w-full rounded-lg border border-line px-4 py-2.5 font-medium hover:border-ink";

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "error"; children: React.ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-lg border px-3 py-2 text-sm border-line bg-panel`}
      style={tone === "error" ? { borderColor: "var(--color-red)" } : undefined}
    >
      {children}
    </p>
  );
}

/** Mensaje de un error de la API para mostrarlo en la página tras redirigir. */
export function apiMessage(e: unknown): string {
  const body = (e as { body?: { message?: string; hint?: string; details?: { message?: string }[] } }).body;
  if (!body?.message) return "Something went wrong. Try again.";
  const detail = Array.isArray(body.details) ? body.details.find((d) => d?.message)?.message : undefined;
  return [detail ?? body.message, body.hint].filter(Boolean).join(" ");
}
