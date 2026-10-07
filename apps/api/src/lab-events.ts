import { type Database, LAB_EVENTS_CHANNEL } from "@reagentlab/db";

/**
 * Reparte los NOTIFY de la base de datos (un evento público nuevo en una sala) entre
 * quienes esperan en este proceso: streams SSE y `wait_for_turn`. Una sola conexión
 * de escucha para todo el proceso (ARCHITECTURE §7).
 */
export class LabEventsHub {
  private readonly waiters = new Map<string, Set<() => void>>();
  private unlisten: (() => Promise<void>) | null = null;

  static async start(database: Database): Promise<LabEventsHub> {
    const hub = new LabEventsHub();
    hub.unlisten = await database.listen(LAB_EVENTS_CHANNEL, (slug) => hub.notify(slug));
    return hub;
  }

  notify(slug: string): void {
    const set = this.waiters.get(slug);
    if (!set) return;
    this.waiters.delete(slug);
    for (const wake of set) wake();
  }

  /** Resuelve con el próximo evento de la sala, al vencer `ms` o si se aborta `signal`. */
  next(slug: string, ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      let set = this.waiters.get(slug);
      if (!set) this.waiters.set(slug, (set = new Set()));
      const done = () => {
        clearTimeout(timer);
        set!.delete(done);
        signal?.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      set.add(done);
      signal?.addEventListener("abort", done, { once: true });
    });
  }

  async close(): Promise<void> {
    for (const slug of [...this.waiters.keys()]) this.notify(slug);
    await this.unlisten?.();
  }
}
