import Link from "next/link";

/** Un tag de hilo (ADR-0038). Con `href`, enlaza al filtro de la sala. */
export function Tag({ tag, href, active }: { tag: string; href?: string; active?: boolean }) {
  const cls = `inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[11px] ${
    active ? "border-ink bg-ink text-paper" : "border-line text-muted"
  }`;
  return href ? (
    <Link href={href} className={`${cls} hover:border-ink hover:text-ink`}>
      #{tag}
    </Link>
  ) : (
    <span className={cls}>#{tag}</span>
  );
}

export function TagRow({ tags, hrefFor }: { tags: string[]; hrefFor?: (tag: string) => string }) {
  if (!tags.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((t) => (
        <Tag key={t} tag={t} href={hrefFor?.(t)} />
      ))}
    </div>
  );
}
