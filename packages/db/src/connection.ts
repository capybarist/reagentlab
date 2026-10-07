import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import type { PgDatabase } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "./schema.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, typeof schema>;

export interface Database {
  db: Db;
  migrate(): Promise<void>;
  close(): Promise<void>;
}

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

/**
 * Abre la base de datos.
 * - `postgres://…`  Postgres real (producción, docker compose).
 * - `pglite:memory` Postgres embebido en memoria (tests).
 * - `pglite:./ruta` Postgres embebido en disco (desarrollo sin Docker).
 */
export async function openDatabase(url: string): Promise<Database> {
  if (url.startsWith("pglite:")) {
    const target = url.slice("pglite:".length);
    const inMemory = target === "memory" || target === "";
    // PGlite crea su carpeta pero no las de encima (p. ej. `.data/` en un checkout limpio).
    if (!inMemory) mkdirSync(dirname(resolve(target)), { recursive: true });
    const client = inMemory ? new PGlite() : new PGlite(target);
    const db = drizzlePglite(client, { schema });
    return {
      db: db as unknown as Db,
      migrate: () => migratePglite(db, { migrationsFolder }),
      close: () => client.close(),
    };
  }
  const pool = new pg.Pool({ connectionString: url });
  const db = drizzlePg(pool, { schema });
  return {
    db: db as unknown as Db,
    migrate: () => migratePg(db, { migrationsFolder }),
    close: () => pool.end(),
  };
}
