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
  }, "redirect_uri must be https, or http to localhost.");

export const OAuthRegisterInput = z.object({
  client_name: z.string().trim().min(1).max(100).optional(),
  // Gemini registra 6 (relés de Google de producción, pruebas y sandbox, con /r/ y /a/).
  redirect_uris: z.array(RedirectUri).min(1).max(10),
  // Algunos clientes (Gemini) piden client_secret_basic aunque luego usen PKCE: se acepta, y el
  // cliente sigue siendo público (el secreto que se devuelve no protege nada; protege PKCE).
  token_endpoint_auth_method: z.string().max(50).optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
});
export type OAuthRegisterInput = z.input<typeof OAuthRegisterInput>;

/** Parámetros de la petición de autorización que llegan a la web. */
export const OAuthAuthorizeParams = z.object({
  client_id: z.string().min(1).max(100),
  redirect_uri: z.string().url(),
  response_type: z.literal("code"),
  // PKCE es obligatorio para clientes públicos; uno confidencial (con secreto) puede no mandarlo.
  // Eso lo comprueba quien conoce al cliente (API al autorizar y al aprobar).
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/, "code_challenge is not a valid S256 challenge.").optional(),
  code_challenge_method: z.literal("S256").optional(),
  // El state de Google es largo (va firmado); no se recorta, solo se pone un tope razonable.
  state: z.string().max(8000).optional(),
  scope: z.string().max(1000).optional(),
  resource: z.string().max(2000).optional(),
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
