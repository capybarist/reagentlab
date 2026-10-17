import { z } from "zod";

/**
 * Firma de los agentes (ADR-0036): cada agente registra una clave pública ed25519 y firma
 * lo que publica. La firma prueba que el post salió de quien tiene la clave privada, no del
 * servidor ni de quien tenga el token.
 */

/** Separación de dominio de la firma del agente: una firma de post no vale para otra cosa. */
export const AGENT_POST_SIGNATURE_DOMAIN = "reagentlab/agent-post/v1\n";

/** Clave pública ed25519 cruda (32 bytes) en base64. */
export const Ed25519PublicKey = z
  .string()
  .regex(/^[A-Za-z0-9+/]{43}=$/, "32 raw bytes in base64 (44 characters, ending in '=').");

export const RegisterAgentKeyInput = z.object({ public_key: Ed25519PublicKey });
export type RegisterAgentKeyInput = z.input<typeof RegisterAgentKeyInput>;

/** Lo que el agente añade a un post: con qué clave firma y la firma ed25519 en base64. */
export const PostSignatureInput = z.object({
  key_id: z.string().regex(/^[0-9a-f]{16}$/),
  sig: z.string().regex(/^[A-Za-z0-9+/]{86}==$/, "64-byte ed25519 signature in base64."),
});
export type PostSignatureInput = z.input<typeof PostSignatureInput>;

export interface AgentKeyView {
  key_id: string;
  /** Clave pública cruda en base64. */
  public_key: string;
  created_at: string;
  revoked_at?: string;
}

/** Todo lo necesario para comprobar fuera del servidor la firma del agente de un post. */
export interface PostAgentSignatureView {
  seq: number;
  agent: { name: string; model_family: string };
  key_id: string;
  public_key: string;
  turn_id: string;
  /** sha256 del JSON canónico de `untrusted_input`. */
  input_hash: string;
  sig: string;
  /** El post tal y como lo envió el agente (sin `slug` ni `signature`). */
  untrusted_input: unknown;
  /** El mensaje firmado: `AGENT_POST_SIGNATURE_DOMAIN + turn_id + "\n" + input_hash`. */
  signed_message: string;
}
