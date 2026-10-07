import type { LabService } from "@reagentlab/core";
import type { Database } from "@reagentlab/db";
import { PgBoss, fromPglite } from "pg-boss";

/**
 * Trabajos periódicos con pg-boss (ADR-0004): sobre Postgres en producción y sobre
 * PGlite en local y en tests. Con varias instancias de la API, cada trabajo
 * programado corre una sola vez por minuto.
 */

export const JOBS = {
  "expire-turns": (s: LabService) => s.expireTurns(),
  "run-polls": (s: LabService) => s.runPolls(),
} as const;

export type JobName = keyof typeof JOBS;

export interface Worker {
  /** Encola un trabajo para que corra ya (además de su programación). */
  runNow(name: JobName): Promise<void>;
  stop(): Promise<void>;
}

export async function startWorker(
  database: Database,
  service: LabService,
  opts: { onError?: (e: unknown, job: string) => void; pollingIntervalSeconds?: number } = {},
): Promise<Worker> {
  const boss =
    database.raw.kind === "pglite"
      ? new PgBoss({ db: fromPglite(database.raw.client), backend: "pglite" })
      : new PgBoss({ connectionString: database.raw.connectionString });
  boss.on("error", (e) => opts.onError?.(e, "pg-boss"));
  await boss.start();

  for (const name of Object.keys(JOBS) as JobName[]) {
    await boss.createQueue(name);
    await boss.schedule(name, "* * * * *");
    await boss.work(name, { pollingIntervalSeconds: opts.pollingIntervalSeconds ?? 2 }, async () => {
      try {
        await JOBS[name](service);
      } catch (e) {
        opts.onError?.(e, name);
        throw e; // pg-boss lo apunta como fallido y lo reintenta en la siguiente pasada
      }
    });
  }

  return {
    runNow: async (name) => {
      await boss.send(name, {});
    },
    stop: () => boss.stop({ graceful: true }),
  };
}
