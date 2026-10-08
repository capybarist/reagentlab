import { createHash, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { EmailLoginInput, EmailResetInput, EmailSignupInput, EmailVerifyInput } from "@reagentlab/contracts";
import { DomainError } from "@reagentlab/core";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "./connection.js";
import { emailCodes, emailCredentials, users } from "./schema.js";

/** Login con email y contraseña (ADR-0022). La API envía los códigos; aquí solo hay datos. */

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const EMAIL_CODE_TTL_MS = 15 * 60 * 1000;
export const EMAIL_CODE_MAX_ATTEMPTS = 5;
/** Un código nuevo por email y propósito como mucho cada minuto. */
export const EMAIL_CODE_RESEND_MS = 60 * 1000;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 32);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, key] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "base64");
  const actual = await scrypt(password, Buffer.from(salt, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

const hashCode = (email: string, code: string, pepper: string) =>
  createHash("sha256").update(`${pepper}:${email}:${code}`).digest("hex");

/**
 * Handle libre a partir de una sugerencia (Google, email): los handles no son únicos entre
 * proveedores, pero las cuentas nuevas no repiten uno existente para no confundir en la web.
 */
export async function uniqueHandle(db: Db, hint: string): Promise<string> {
  const base =
    hint
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 34) || "user";
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? base : `${base}-${i}`;
    const [taken] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.handle}) = ${candidate}`);
    if (!taken) return candidate;
  }
}

async function issueCode(
  db: Db,
  email: string,
  purpose: "signup" | "reset",
  pepper: string,
  now: Date,
  pending: { passwordHash?: string; handle?: string } = {},
): Promise<string | null> {
  const [last] = await db
    .select()
    .from(emailCodes)
    .where(and(eq(emailCodes.email, email), eq(emailCodes.purpose, purpose)))
    .orderBy(desc(emailCodes.createdAt))
    .limit(1);
  if (last && now.getTime() - last.createdAt.getTime() < EMAIL_CODE_RESEND_MS) return null;
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.insert(emailCodes).values({
    email,
    purpose,
    codeHash: hashCode(email, code, pepper),
    pendingPasswordHash: pending.passwordHash ?? null,
    pendingHandle: pending.handle ?? null,
    expiresAt: new Date(now.getTime() + EMAIL_CODE_TTL_MS),
    createdAt: now,
  });
  return code;
}

/** Consume el código vigente más reciente, o lanza CODE_INVALID (y cuenta el intento). */
async function consumeCode(db: Db, email: string, code: string, purpose: "signup" | "reset", pepper: string, now: Date) {
  const [row] = await db
    .select()
    .from(emailCodes)
    .where(and(eq(emailCodes.email, email), eq(emailCodes.purpose, purpose), isNull(emailCodes.consumedAt)))
    .orderBy(desc(emailCodes.createdAt))
    .limit(1);
  const invalid = (msg: string, hint = "Request a new code and try again.") => new DomainError("CODE_INVALID", msg, hint);
  if (!row || row.expiresAt <= now) throw invalid("This code has expired or does not exist.");
  if (row.attempts >= EMAIL_CODE_MAX_ATTEMPTS) throw invalid("Too many wrong attempts for this code.");
  const ok = timingSafeEqual(Buffer.from(row.codeHash), Buffer.from(hashCode(email, code, pepper)));
  if (!ok) {
    await db.update(emailCodes).set({ attempts: row.attempts + 1 }).where(eq(emailCodes.id, row.id));
    const left = EMAIL_CODE_MAX_ATTEMPTS - row.attempts - 1;
    throw invalid("The code is not correct.", left > 0 ? `Check it and try again (${left} attempts left).` : undefined);
  }
  await db.update(emailCodes).set({ consumedAt: now }).where(eq(emailCodes.id, row.id));
  return row;
}

async function credentialByEmail(db: Db, email: string) {
  const [row] = await db.select().from(emailCredentials).where(eq(emailCredentials.email, email));
  return row ?? null;
}

/** Alta, paso 1: guarda la contraseña (con hash) pendiente y devuelve el código que hay que enviar. */
export async function startEmailSignup(db: Db, input: EmailSignupInput, pepper: string, now: Date): Promise<string> {
  if (await credentialByEmail(db, input.email)) {
    throw new DomainError("EMAIL_TAKEN", "There is already an account with this email.", "Sign in, or reset your password.");
  }
  const code = await issueCode(db, input.email, "signup", pepper, now, {
    passwordHash: await hashPassword(input.password),
    handle: input.handle,
  });
  if (!code) throw new DomainError("TOO_MANY_REQUESTS", "A code was sent less than a minute ago.", "Check your inbox, or wait a minute.");
  return code;
}

/** Alta, paso 2: con el código correcto crea el humano y su credencial. */
export async function verifyEmailSignup(db: Db, input: EmailVerifyInput, pepper: string, now: Date) {
  const row = await consumeCode(db, input.email, input.code, "signup", pepper, now);
  if (await credentialByEmail(db, input.email)) {
    throw new DomainError("EMAIL_TAKEN", "There is already an account with this email.", "Sign in, or reset your password.");
  }
  const handle = await uniqueHandle(db, row.pendingHandle ?? input.email.split("@")[0]!);
  return db.transaction(async (tx) => {
    const [user] = await tx.insert(users).values({ provider: "email", providerId: input.email, handle }).returning();
    await tx.insert(emailCredentials).values({ userId: user!.id, email: input.email, passwordHash: row.pendingPasswordHash! });
    return user!;
  });
}

/** El humano de ese email y contraseña, o null. Mismo coste si el email no existe. */
export async function loginWithEmail(db: Db, input: EmailLoginInput) {
  const cred = await credentialByEmail(db, input.email);
  if (!cred) {
    await hashPassword(input.password);
    return null;
  }
  if (!(await verifyPassword(input.password, cred.passwordHash))) return null;
  const [user] = await db.select().from(users).where(eq(users.id, cred.userId));
  return user ?? null;
}

/** Cambio de contraseña, paso 1: el código si hay cuenta y no se pidió otro hace menos de un minuto. */
export async function startPasswordReset(db: Db, email: string, pepper: string, now: Date): Promise<string | null> {
  if (!(await credentialByEmail(db, email))) return null;
  return issueCode(db, email, "reset", pepper, now);
}

/** Cambio de contraseña, paso 2. */
export async function finishPasswordReset(db: Db, input: EmailResetInput, pepper: string, now: Date) {
  const cred = await credentialByEmail(db, input.email);
  if (!cred) throw new DomainError("CODE_INVALID", "This code has expired or does not exist.", "Request a new code.");
  await consumeCode(db, input.email, input.code, "reset", pepper, now);
  await db
    .update(emailCredentials)
    .set({ passwordHash: await hashPassword(input.password), updatedAt: now })
    .where(eq(emailCredentials.userId, cred.userId));
  const [user] = await db.select().from(users).where(eq(users.id, cred.userId));
  return user!;
}
