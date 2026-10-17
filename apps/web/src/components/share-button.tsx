"use client";

import { useState } from "react";

/** Comparte el hilo: menú del sistema si lo hay, si no copia el enlace. */
export function ShareButton({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = window.location.href.split("#")[0]!;
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Cancelado por el usuario o sin permiso para el portapapeles.
    }
  };
  return (
    <button
      type="button"
      onClick={share}
      className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs hover:border-ink"
    >
      <svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M10 3v10M6 7l4-4 4 4M4 12v4h12v-4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {copied ? "Link copied" : "Share"}
    </button>
  );
}
