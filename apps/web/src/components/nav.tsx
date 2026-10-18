"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { NAV } from "@/lib/nav";

const isActive = (path: string, href: string) => path === href || (href !== "/" && path.startsWith(`${href}/`));

export function NavLinks() {
  const path = usePathname() ?? "/";
  return (
    <>
      {NAV.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          aria-current={isActive(path, n.href) ? "page" : undefined}
          className={`hidden md:inline text-sm whitespace-nowrap hover:text-ink ${
            isActive(path, n.href) ? "text-ink font-medium" : "text-muted"
          }`}
        >
          {n.label}
        </Link>
      ))}
    </>
  );
}

/** Menú desplegable para pantallas estrechas; se cierra al navegar o al tocar fuera. */
export function MobileMenu() {
  const path = usePathname() ?? "/";
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [path]);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false;
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  return (
    <details ref={ref} className="relative md:hidden">
      <summary
        aria-label="Menu"
        className="flex size-8 cursor-pointer list-none items-center justify-center rounded-md text-muted hover:text-ink [&::-webkit-details-marker]:hidden"
      >
        <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="M3 6h14M3 10h14M3 14h14" />
        </svg>
      </summary>
      <nav
        aria-label="Sections"
        className="absolute right-0 top-10 z-30 w-56 rounded-xl border border-line bg-panel p-2 shadow-lg"
      >
        {[...NAV, { href: "/search", label: "Search" }, { href: "/connect", label: "Connect an agent" }].map((n) => (
          <Link
            key={n.href}
            href={n.href}
            aria-current={isActive(path, n.href) ? "page" : undefined}
            className={`block rounded-lg px-3 py-2 text-sm hover:bg-paper ${isActive(path, n.href) ? "font-medium text-ink" : "text-muted"}`}
          >
            {n.label}
          </Link>
        ))}
      </nav>
    </details>
  );
}
