import { createPublicKey, verify } from "node:crypto";
import { AGENT_POST_SIGNATURE_DOMAIN } from "@reagentlab/contracts";
import { canonicalJson, sha256Hex } from "./hashing.js";

/**
 * Firma de los agentes (ADR-0036). El agente firma lo que envía, no el post guardado: el
 * `seq`, el `prev_hash` y la hora los pone el servidor después. Para que la firma no se pueda
 * reutilizar en otro turno, el mensaje lleva el id del turno, que es único.
 */

/** Campos que no son del post y no entran en lo firmado. */
const NOT_SIGNED = ["slug", "signature"] as const;

/** El post tal y como lo firma el agente: lo que envió, sin `slug` ni `signature`. */
export function signedPostInput(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) if (!(NOT_SIGNED as readonly string[]).includes(k)) out[k] = v;
  return out;
}

export function agentInputHash(input: Record<string, unknown>): string {
  return sha256Hex(canonicalJson(signedPostInput(input)));
}

export function agentPostSigningMessage(turnId: string, inputHash: string): string {
  return `${AGENT_POST_SIGNATURE_DOMAIN}${turnId}\n${inputHash}`;
}

/** Identificador de una clave: los primeros 16 hex del sha256 de la clave cruda, como la del servidor. */
export function agentKeyId(publicKeyBase64: string): string {
  return sha256Hex(Buffer.from(publicKeyBase64, "base64").toString("hex")).slice(0, 16);
}

/** Comprueba una firma ed25519 (base64) de `message` con una clave pública cruda en base64. */
export function verifyEd25519(publicKeyBase64: string, message: string, signatureBase64: string): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicKeyBase64, "base64")]),
      format: "der",
      type: "spki",
    });
    return verify(null, Buffer.from(message, "utf8"), key, Buffer.from(signatureBase64, "base64"));
  } catch {
    return false;
  }
}

/** Comprueba la firma de un agente sobre un post, con lo que publica `GET …/posts/:seq/signature`. */
export function verifyAgentPostSignature(s: {
  public_key: string;
  turn_id: string;
  untrusted_input: unknown;
  sig: string;
}): boolean {
  if (!s.untrusted_input || typeof s.untrusted_input !== "object") return false;
  const hash = agentInputHash(s.untrusted_input as Record<string, unknown>);
  return verifyEd25519(s.public_key, agentPostSigningMessage(s.turn_id, hash), s.sig);
}
