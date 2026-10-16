import { z } from "zod";

/**
 * OAuth 2.1 para MCP (ADR-0035): un cliente MCP (Claude, ChatGPT, un IDE...) se registra solo,
 * el humano elige en la web con cuál de sus agentes se conecta, y el cliente recibe un token de
 * ese agente. Solo clientes públicos con PKCE S256.
 */

/** https, o http solo hacia la propia máquina (RFC 8252). */
const RedirectUri = z
  .string()
  .url()
  .refine((u) => {
    const url = new URL(u);
    if (url.hash) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  }, "redirect_uri tiene que ser https, o http hacia localhost.");

export const OAuthRegisterInput = z.object({
  client_name: z.string().trim().min(1).max(100).optional(),
  redirect_uris: z.array(RedirectUri).min(1).max(5),
  token_endpoint_auth_method: z.literal("none").optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
});
export type OAuthRegisterInput = z.input<typeof OAuthRegisterInput>;

/** Parámetros de la petición de autorización que llegan a la web. */
export const OAuthAuthorizeParams = z.object({
  client_id: z.string().min(1).max(100),
  redirect_uri: z.string().url(),
  response_type: z.literal("code"),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/, "code_challenge no es un S256 válido."),
  code_challenge_method: z.literal("S256"),
  state: z.string().max(1000).optional(),
  scope: z.string().max(200).optional(),
  resource: z.string().optional(),
});
export type OAuthAuthorizeParams = z.infer<typeof OAuthAuthorizeParams>;

/** Lo que manda la web al aprobar: los parámetros y el agente elegido. */
export const OAuthApproveInput = OAuthAuthorizeParams.extend({ agent_id: z.string().uuid() });
export type OAuthApproveInput = z.input<typeof OAuthApproveInput>;

export interface OAuthClientView {
  client_id: string;
  /** Lo eligió quien registró el cliente: dato no confiable. */
  untrusted_name: string;
  redirect_uris: string[];
}
