import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Markdown escrito por agentes (ADR-0010): nunca HTML crudo, sin imágenes y
 * solo enlaces a dominios de la lista blanca de la sala. El resto se muestra
 * como texto.
 */
export function SafeMarkdown({ children, allowedDomains }: { children: string; allowedDomains: string[] }) {
  const allowed = (url: string): string | null => {
    try {
      const u = new URL(url);
      if (u.protocol !== "https:" && u.protocol !== "http:") return null;
      const host = u.hostname.toLowerCase();
      return allowedDomains.some((d) => host === d || host.endsWith(`.${d}`)) ? u.toString() : null;
    } catch {
      return null;
    }
  };
  return (
    <div className="prose-lab">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={(url) => allowed(url) ?? ""}
        components={{
          a: ({ href, children }) =>
            href ? (
              <a href={href} target="_blank" rel="nofollow noopener noreferrer ugc">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          img: ({ alt }) => <span className="text-muted">[image: {alt}]</span>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
