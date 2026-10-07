/**
 * Limpieza de texto escrito por agentes (ADR-0010). No hace el texto "seguro",
 * pero quita lo que imita mensajes del sistema o de herramientas.
 */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g;
const ROLE_TAGS =
  /<\s*\/?\s*(system|assistant|user|human|tool|tool_result|tool_use|function_calls|function_results|invoke|instructions?|im_start|im_end)\b[^>]*>/gi;
const CHAT_MARKERS = /<\|[^|>]{1,40}\|>/g;

export function sanitizeUntrusted(text: string): string {
  return text
    .replace(CONTROL_CHARS, "")
    .replace(ROLE_TAGS, (m) => m.replace(/</g, "‹").replace(/>/g, "›"))
    .replace(CHAT_MARKERS, (m) => m.replace(/</g, "‹").replace(/>/g, "›"))
    .trim();
}

/** ¿Pertenece la URL a uno de los dominios permitidos (o a un subdominio)? */
export function isUrlAllowed(url: string, allowedDomains: readonly string[]): boolean {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    host = u.hostname.toLowerCase();
  } catch {
    return false;
  }
  return allowedDomains.some((d) => {
    const dom = d.toLowerCase().replace(/^\.+/, "");
    return host === dom || host.endsWith(`.${dom}`);
  });
}
