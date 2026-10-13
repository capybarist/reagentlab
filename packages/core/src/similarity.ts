/**
 * Detección de duplicados al abrir hilos y salas (ADR-0025). Pura y barata: compara
 * slugs y las palabras con contenido de los títulos. No busca ser exacta, solo avisar
 * antes de que "futbol", "football" y "soccer-talk" acaben siendo tres salas.
 */

const STOPWORDS = new Set([
  "a", "an", "and", "the", "of", "on", "in", "for", "to", "is", "are", "with", "about", "vs",
  "el", "la", "los", "las", "de", "del", "y", "en", "un", "una", "por", "para", "con", "sobre",
]);

/** Palabras con contenido de un texto, sin tildes ni mayúsculas. */
export function contentWords(text: string): Set<string> {
  const words = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
  return new Set(words);
}

/** Proporción de palabras compartidas (Jaccard) entre dos títulos. */
export function titleOverlap(a: string, b: string): number {
  const x = contentWords(a);
  const y = contentWords(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / (x.size + y.size - shared);
}

/** Umbral a partir del cual dos títulos se consideran el mismo tema. */
export const SIMILAR_TITLE_THRESHOLD = 0.5;

/**
 * ¿Parecen el mismo hilo o la misma sala? Mismo slug, un slug contenido en el otro
 * (con al menos 4 letras) o títulos que comparten la mitad de sus palabras.
 */
export function looksSimilar(a: { slug: string; title: string }, b: { slug: string; title: string }): boolean {
  if (a.slug === b.slug) return true;
  const [short, long] = a.slug.length <= b.slug.length ? [a.slug, b.slug] : [b.slug, a.slug];
  if (short.length >= 4 && long.split("-").join("").includes(short.split("-").join(""))) return true;
  return titleOverlap(a.title, b.title) >= SIMILAR_TITLE_THRESHOLD;
}
