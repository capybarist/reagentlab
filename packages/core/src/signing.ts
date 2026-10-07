import { createPrivateKey, createPublicKey, randomBytes, sign, verify, type KeyObject } from "node:crypto";
import { sha256Hex } from "./hashing.js";

/**
 * Firma del servidor (ADR-0009): ed25519 sobre el `content_hash` de cada post, con
 * separación de dominio para que una firma de post no valga para otra cosa.
 * La firma prueba integridad (salió así de este servidor), no autoría.
 */

export const POST_SIGNATURE_DOMAIN = "reagentlab/post/v1\n";

export interface Signer {
  /** Identificador corto de la clave: los primeros 16 hex del sha256 de la clave pública cruda. */
  keyId: string;
  /** Firma `message` y devuelve la firma en base64. */
  sign(message: string): string;
}

export interface SigningKey extends Signer {
  algorithm: "ed25519";
  publicKeyPem: string;
  /** Clave pública cruda (32 bytes) en base64. */
  publicKeyRaw: string;
}

// Cabecera DER PKCS#8 de una clave privada ed25519; le sigue la semilla de 32 bytes.
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export function postSigningMessage(contentHash: string): string {
  return POST_SIGNATURE_DOMAIN + contentHash;
}

/** Semilla nueva de 32 bytes en base64, para `SIGNING_KEY`. */
export function generateSigningSeed(): string {
  return randomBytes(32).toString("base64");
}

export function signingKeyFromSeed(seedBase64: string): SigningKey {
  const seed = Buffer.from(seedBase64, "base64");
  if (seed.length !== 32) throw new Error("SIGNING_KEY debe ser una semilla ed25519 de 32 bytes en base64.");
  const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: "der", type: "pkcs8" });
  const publicKey = createPublicKey(privateKey);
  const raw = rawPublicKey(publicKey);
  return {
    algorithm: "ed25519",
    keyId: sha256Hex(raw.toString("hex")).slice(0, 16),
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
    publicKeyRaw: raw.toString("base64"),
    sign: (message) => sign(null, Buffer.from(message, "utf8"), privateKey).toString("base64"),
  };
}

/** Comprueba la firma de un post con la clave pública publicada (PEM o cruda en base64). */
export function verifyPostSignature(contentHash: string, signatureBase64: string, publicKey: string): boolean {
  const key = publicKey.includes("BEGIN PUBLIC KEY")
    ? createPublicKey(publicKey)
    : createPublicKey({
        key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicKey, "base64")]),
        format: "der",
        type: "spki",
      });
  try {
    return verify(null, Buffer.from(postSigningMessage(contentHash), "utf8"), key, Buffer.from(signatureBase64, "base64"));
  } catch {
    return false;
  }
}

function rawPublicKey(key: KeyObject): Buffer {
  const der = key.export({ format: "der", type: "spki" });
  return der.subarray(der.length - 32);
}
