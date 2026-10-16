import type { LabService, Sandbox } from "@reagentlab/core";
import type { Database } from "@reagentlab/db";
import { PgBoss, fromPglite } from "pg-boss";

/**
 * Trabajos periódicos con pg-boss (ADR-0004): sobre Postgres en producción y sobre
 * PGlite en local y en tests. Con varias instancias de la API, cada trabajo
 * programado corre una sola vez en cada pasada.
 */

interface JobContext {
  /** Sandbox del host (ADR-0033); sin él no se reproduce nada. */
  sandbox?: Sandbox;
}

export const JOBS = {
  "expire-turns": (s: LabService) => s.expireTurns(),
  "run-polls": (s: LabService) => s.runPolls(),
  "lab-lifecycle": (s: LabService) => s.runLabLifecycle(),
  "reveal-canaries": (s: LabService) => s.revealDueCanaries(),
  "host-reproductions": (s: LabService, ctx: JobContext) => (ctx.sandbox ? s.runHostReproductions(ctx.sandbox) : 0),
} as const;

/** Cada cuánto corre cada trabajo (cron). El ciclo de vida de las salas no corre prisa. */
const SCHEDULES: Record<JobName, string> = {
  "expire-turns": "* * * * *",
  "run-polls": "* * * * *",
  "lab-lifecycle": "17 * * * *",
  "reveal-canaries": "23 * * * *",
  "host-reproductions": "*/5 * * * *",
};

export type JobName = keyof typeof JOBS;

export interface Worker {
  /** Encola un trabajo para que corra ya (además de su programación). */
  runNow(name: JobName): Promise<void>;
  stop(): Promise<void>;
}

export async function startWorker(
  database: Database,
  service: LabService,
  opts: { onError?: (e: unknown, job: string) => void; pollingIntervalSeconds?: number; sandbox?: Sandbox } = {},
): Promise<Worker> {
  const boss =
    database.raw.kind === "pglite"
      ? new PgBoss({ db: fromPglite(database.raw.client), backend: "pglite" })
      : new PgBoss({ connectionString: database.raw.connectionString });
  boss.on("error", (e) => opts.onError?.(e, "pg-boss"));
  await boss.start();

  for (const name of Object.keys(JOBS) as JobName[]) {
    await boss.createQueue(name);
    await boss.schedule(name, SCHEDULES[name]);
    await boss.work(name, { pollingIntervalSeconds: opts.pollingIntervalSeconds ?? 2 }, async () => {
      try {
        await JOBS[name](service, { sandbox: opts.sandbox });
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
