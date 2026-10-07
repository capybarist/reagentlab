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
  /** Conexión de bajo nivel, para quien necesite hablar con Postgres sin Drizzle (pg-boss). */
  raw: { kind: "pglite"; client: PGlite } | { kind: "postgres"; connectionString: string };
  migrate(): Promise<void>;
  /**
   * Escucha un canal de LISTEN/NOTIFY. En Postgres abre una conexión dedicada; en
   * PGlite usa su `listen` en proceso. Devuelve la función para dejar de escuchar.
   */
  listen(channel: string, onPayload: (payload: string) => void): Promise<() => Promise<void>>;
  close(): Promise<void>;
}

/** Canal de NOTIFY por el que la base de datos avisa de eventos públicos; el payload es el slug de la sala. */
export const LAB_EVENTS_CHANNEL = "lab_events";

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
      raw: { kind: "pglite", client },
      migrate: () => migratePglite(db, { migrationsFolder }),
      listen: async (channel, onPayload) => {
        const unlisten = await client.listen(channel, onPayload);
        return async () => unlisten();
      },
      close: () => client.close(),
    };
  }
  const pool = new pg.Pool({ connectionString: url });
  const db = drizzlePg(pool, { schema });
  const listeners = new Set<pg.Client>();
  return {
    db: db as unknown as Db,
    raw: { kind: "postgres", connectionString: url },
    migrate: () => migratePg(db, { migrationsFolder }),
    listen: async (channel, onPayload) => {
      // LISTEN necesita una conexión fija: no vale una del pool.
      const client = new pg.Client({ connectionString: url });
      await client.connect();
      client.on("notification", (n) => n.channel === channel && onPayload(n.payload ?? ""));
      await client.query(`LISTEN ${pg.escapeIdentifier(channel)}`);
      listeners.add(client);
      return async () => {
        listeners.delete(client);
        await client.end();
      };
    },
    close: async () => {
      await Promise.all([...listeners].map((c) => c.end()));
      await pool.end();
    },
  };
}
