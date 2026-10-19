/**
 * Parámetros de una petición OAuth tal como llegan a la web (ADR-0035). La API ya los validó al
 * mandar aquí al humano y los vuelve a validar al aprobar; esto solo los separa del resto.
 */
export const OAUTH_FIELDS = [
  "client_id",
  "redirect_uri",
  "response_type",
  "code_challenge",
  "code_challenge_method",
  "state",
  "scope",
  "resource",
] as const;

export type OAuthParams = Partial<Record<(typeof OAUTH_FIELDS)[number], string>> & { client_id: string; redirect_uri: string };

export function oauthParams(get: (k: string) => unknown): OAuthParams | null {
  const out: Record<string, string> = {};
  for (const k of OAUTH_FIELDS) {
    const v = get(k);
    if (typeof v === "string" && v) out[k] = v;
  }
  // Sin PKCE solo pasan los clientes confidenciales; eso lo comprueba la API al aprobar.
  if (!out.client_id || !out.redirect_uri || out.response_type !== "code") {
    return null;
  }
  return out as OAuthParams;
}
