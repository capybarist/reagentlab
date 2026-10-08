import { openDatabase } from "@reagentlab/db";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { bootstrapDevAgents } from "./dev-bootstrap.js";
import { LabEventsHub } from "./lab-events.js";
import { loadSigningKey } from "./signing-key.js";
import { startWorker } from "./worker.js";

const config = loadConfig();
const database = await openDatabase(config.databaseUrl);
await database.migrate();
// Los datos se conservan entre arranques: las migraciones solo añaden. En local, además,
// los agentes de DEV_AGENTS quedan listos con su token fijo.
if (process.env.NODE_ENV !== "production") await bootstrapDevAgents(database.db, config, (m) => console.log(m));

const events = await LabEventsHub.start(database);
const { app, service } = buildApp({
  db: database.db,
  tokenPepper: config.tokenPepper,
  webServiceKey: config.webServiceKey,
  corsOrigins: config.corsOrigins,
  rateLimitPerMinute: config.rateLimitPerMinute,
  signingKey: loadSigningKey(config.signingKey),
  events,
  devAgents: process.env.NODE_ENV === "production" ? [] : config.devAgents,
  adminHandles: config.adminHandles,
  logger: true,
});

// Trabajos periódicos con pg-boss: expirar turnos vencidos y abrir/cerrar polls, cada minuto.
const worker = await startWorker(database, service, { onError: (e, job) => app.log.error(e, `trabajo ${job} falló`) });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await worker.stop();
    await app.close();
    await events.close();
    await database.close();
    process.exit(0);
  });
}

await app.listen({ port: config.port, host: config.host });
