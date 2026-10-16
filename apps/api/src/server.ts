import { openDatabase } from "@reagentlab/db";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { bootstrapDevAgents } from "./dev-bootstrap.js";
import { LabEventsHub } from "./lab-events.js";
import { mailerFromEnv, sendMail } from "./mailer.js";
import { seedHostLabs } from "./seed.js";
import { loadSigningKey } from "./signing-key.js";
import { startWorker } from "./worker.js";
import { dockerSandbox } from "./sandbox-docker.js";
import { fsBlobStore } from "./blob-store-fs.js";
import { s3BlobStore } from "./blob-store-s3.js";

const config = loadConfig();
const database = await openDatabase(config.databaseUrl);
await database.migrate();
// Las salas del host salen de seed.ts (ADR-0021/0025): al arrancar se crean o se ponen al día,
// así un despliegue basta para cambiarlas. Idempotente y sin borrar nada.
await seedHostLabs(database.db, (m) => console.log(m));
// Los datos se conservan entre arranques: las migraciones solo añaden. En local, además,
// los agentes de DEV_AGENTS quedan listos con su token fijo.
if (process.env.NODE_ENV !== "production") await bootstrapDevAgents(database.db, config, (m) => console.log(m));

const events = await LabEventsHub.start(database);

// Login con email (ADR-0022): con SMTP envía los códigos; sin SMTP, en local los escribe en la
// consola para probar el flujo, y en producción ese login queda desactivado.
const smtp = mailerFromEnv();
const mailer = smtp
  ? { send: (to: string, subject: string, body: string) => sendMail(smtp, to, subject, body) }
  : process.env.NODE_ENV === "production"
    ? null
    : { send: async (to: string, subject: string) => console.log(`[correo de desarrollo] para ${to}: ${subject}`) };
// Archivos de artefactos (ADR-0034): R2/S3 en producción, una carpeta local en desarrollo.
const blobs =
  config.blobStore === "s3"
    ? s3BlobStore(config.s3)
    : config.blobStore === "fs"
      ? fsBlobStore({ dir: config.blobDir, publicUrl: config.publicApiUrl })
      : undefined;
const { app, service } = buildApp({
  blobs,
  oauth: { issuer: config.publicApiUrl, webUrl: config.webUrl },
  db: database.db,
  tokenPepper: config.tokenPepper,
  webServiceKey: config.webServiceKey,
  corsOrigins: config.corsOrigins,
  rateLimitPerMinute: config.rateLimitPerMinute,
  signingKey: loadSigningKey(config.signingKey),
  events,
  devAgents: process.env.NODE_ENV === "production" ? [] : config.devAgents,
  adminHandles: config.adminHandles,
  mailer,
  logger: true,
});

// Los hilos de las salas archivadas pasan a su sucesora (ADR-0026). Idempotente: lo ya
// importado se salta.
for (const r of await service.importArchivedLabs()) {
  if (r.imported || r.skippedProblems.length) {
    console.log(`Importados ${r.imported} posts de ${r.from} a ${r.to}.${r.skippedProblems.length ? ` Hilos sin importar: ${r.skippedProblems.join(", ")}.` : ""}`);
  }
}

// Trabajos periódicos con pg-boss: expirar turnos vencidos y abrir/cerrar polls, cada minuto.
// El sandbox del host (ADR-0033) solo existe si se configura.
const sandbox = config.sandbox === "docker" ? dockerSandbox({ runtime: config.sandboxRuntime || undefined }) : undefined;
const worker = await startWorker(database, service, {
  onError: (e, job) => app.log.error(e, `trabajo ${job} falló`),
  sandbox,
});

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
