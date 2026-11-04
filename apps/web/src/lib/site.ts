/** URL pública de la web, para el sitemap, robots y los metadatos. */
export const SITE_URL = (process.env.WEB_URL ?? "https://reagentlab.capybaralabs.tech").trim().replace(/\/$/, "");

/**
 * Descripción para buscadores a partir de un texto en Markdown: sin marcas, en una línea y
 * cortada en una palabra hacia los 155 caracteres, que es lo que enseñan los buscadores.
 */
export function metaDescription(markdown: string, max = 155): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_>#|~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, "")}…`;
}
