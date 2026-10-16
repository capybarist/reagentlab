import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BlobStore } from "@reagentlab/core";

/**
 * Almacenamiento de artefactos en una carpeta local (ADR-0034), para desarrollo y pruebas. Imita
 * a R2: URLs firmadas con HMAC que atiende la propia API en `/v1/blobs/fs/:sha256`.
 */
export interface FsBlobStore extends BlobStore {
  /** Comprueba la firma de una URL: `op` es put o get. */
  verify(op: "put" | "get", sha256: string, exp: string, sig: string, now?: Date): boolean;
  /** Guarda el cuerpo de una subida si tiene ese sha256; devuelve false si no. */
  store(sha256: string, body: Buffer): Promise<boolean>;
  read(sha256: string): Promise<Buffer | null>;
}

export function fsBlobStore(opts: { dir: string; publicUrl: string; secret?: string }): FsBlobStore {
  const secret = opts.secret ?? randomBytes(32).toString("hex");
  const path = (sha256: string) => join(opts.dir, sha256);
  const sign = (op: string, sha256: string, exp: string) =>
    createHmac("sha256", secret).update(`${op}\n${sha256}\n${exp}`).digest("hex");
  const url = (op: "put" | "get", sha256: string, expiresSec: number) => {
    const exp = String(Math.floor(Date.now() / 1000) + expiresSec);
    return `${opts.publicUrl.replace(/\/$/, "")}/v1/blobs/fs/${sha256}?op=${op}&exp=${exp}&sig=${sign(op, sha256, exp)}`;
  };
  const read = async (sha256: string) => readFile(path(sha256)).catch(() => null);
  return {
    kind: "fs",
    async presignPut(sha256, _bytes, expiresSec) {
      return { url: url("put", sha256, expiresSec), headers: { "content-type": "application/octet-stream" } };
    },
    async presignGet(sha256, expiresSec) {
      return url("get", sha256, expiresSec);
    },
    async head(sha256) {
      const s = await stat(path(sha256)).catch(() => null);
      return s ? { bytes: s.size } : null;
    },
    async get(sha256) {
      const b = await read(sha256);
      if (!b) throw new Error(`No existe ${sha256} en el almacenamiento local.`);
      return new Uint8Array(b);
    },
    verify(op, sha256, exp, sig, now = new Date()) {
      if (!/^\d+$/.test(exp) || Number(exp) * 1000 < now.getTime()) return false;
      const want = Buffer.from(sign(op, sha256, exp), "hex");
      const got = Buffer.from(sig, "hex");
      return got.length === want.length && timingSafeEqual(got, want);
    },
    async store(sha256, body) {
      if (createHash("sha256").update(body).digest("hex") !== sha256) return false;
      await mkdir(opts.dir, { recursive: true });
      const tmp = `${path(sha256)}.${randomBytes(4).toString("hex")}.part`;
      await writeFile(tmp, body);
      await rename(tmp, path(sha256));
      return true;
    },
    read,
  };
}
