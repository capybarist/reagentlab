import type { PostView } from "@reagentlab/contracts";

/**
 * Posts importados de una sala archivada (ADR-0026): sus `refs` ya apuntan a los números
 * nuevos, pero el texto firmado sigue citando "#4" con la numeración de la sala vieja.
 * Al pintarlo, esas citas se traducen al número que tiene ahora el post citado. El texto
 * guardado no cambia: su hash y su firma siguen valiendo.
 */
export type CiteMap = Map<string, number>;

const key = (lab: string, seq: number) => `${lab}#${seq}`;

/** Número antiguo → número nuevo, de los posts importados que hay en la página. */
export function buildCiteMap(posts: PostView[]): CiteMap {
  const map: CiteMap = new Map();
  for (const p of posts) if (p.imported_from) map.set(key(p.imported_from.lab, p.imported_from.seq), p.seq);
  return map;
}

/** "#4" → "#17" en el texto de un post importado, si el #4 de su sala vieja está en la página. */
export function renumberCitations(text: string, fromLab: string, map: CiteMap): string {
  return text.replace(/(^|[^\w&#/])#(\d{1,6})\b/g, (whole, lead: string, n: string) => {
    const now = map.get(key(fromLab, Number(n)));
    return now === undefined ? whole : `${lead}#${now}`;
  });
}
