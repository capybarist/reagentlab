import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "./connection.js";
import { oauthClients, oauthCodes } from "./schema.js";

/**
 * Almacén de OAuth para MCP (ADR-0035): clientes registrados y códigos de autorización. Los
 * tokens que salen del intercambio son tokens de agente normales (`issueToken`).
 */

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Registra un cliente. Con `confidential`, genera un secreto y guarda solo su hash; el secreto en
 * claro se devuelve una vez, para la respuesta del registro.
 */
export async function registerOAuthClient(db: Db, c: { name: string; redirectUris: string[]; now: Date; confidential?: boolean }) {
  const clientId = `rl_cl_${randomBytes(12).toString("hex")}`;
  const secret = c.confidential ? randomBytes(24).toString("base64url") : null;
  const [row] = await db
    .insert(oauthClients)
    .values({ clientId, name: c.name, redirectUris: c.redirectUris, secretHash: secret ? sha(secret) : null, createdAt: c.now })
    .returning();
  return { ...row!, secret };
}

/** ¿Es este el secreto del cliente? Falso si el cliente es público. */
export function clientSecretMatches(client: { secretHash: string | null }, secret: string | undefined): boolean {
  if (!client.secretHash || !secret) return false;
  const a = Buffer.from(sha(secret), "hex");
  const b = Buffer.from(client.secretHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function getOAuthClient(db: Db, clientId: string) {
  const [row] = await db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId));
  return row ?? null;
}

/** Crea un código de un solo uso y devuelve el código en claro (solo se guarda su hash). */
export async function createOAuthCode(
  db: Db,
  c: { clientId: string; userId: string; agentId: string; redirectUri: string; codeChallenge: string | null; now: Date; ttlMs: number },
): Promise<string> {
  const code = randomBytes(24).toString("base64url");
  await db.insert(oauthCodes).values({
    codeHash: sha(code),
    clientId: c.clientId,
    userId: c.userId,
    agentId: c.agentId,
    redirectUri: c.redirectUri,
    codeChallenge: c.codeChallenge,
    expiresAt: new Date(c.now.getTime() + c.ttlMs),
    createdAt: c.now,
  });
  return code;
}

/** Gasta un código: lo marca usado si no lo estaba y no ha caducado. Devuelve su fila o null. */
export async function consumeOAuthCode(db: Db, code: string, now: Date) {
  const [row] = await db
    .update(oauthCodes)
    .set({ usedAt: now })
    .where(and(eq(oauthCodes.codeHash, sha(code)), isNull(oauthCodes.usedAt), gt(oauthCodes.expiresAt, now)))
    .returning();
  return row ?? null;
}
