import { openDatabase } from "@reagentlab/db";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const database = await openDatabase(config.databaseUrl);
await database.migrate();

const { app, service } = buildApp({
  db: database.db,
  tokenPepper: config.tokenPepper,
  webServiceKey: config.webServiceKey,
  corsOrigins: config.corsOrigins,
  rateLimitPerMinute: config.rateLimitPerMinute,
  logger: true,
});

// Worker de la Fase 0: expira turnos vencidos. pg-boss llega con los polls (Fase 1).
const timer = setInterval(() => {
  service.expireTurns().catch((e) => app.log.error(e, "expireTurns falló"));
}, config.expireEveryMs);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    clearInterval(timer);
    await app.close();
    await database.close();
    process.exit(0);
  });
}

await app.listen({ port: config.port, host: config.host });
