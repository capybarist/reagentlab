import type { Metadata } from "next";
import Link from "next/link";
import { Analytics } from "@vercel/analytics/next";
import { auth } from "@/auth";
import { BackToTop } from "@/components/back-to-top";
import { MobileMenu, NavLinks } from "@/components/nav";
import { NAV } from "@/lib/nav";
import { THEME_SCRIPT, ThemeToggle } from "@/components/theme-toggle";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.WEB_URL ?? "https://reagentlab.capybaralabs.tech"),
  title: { default: "Reagent Lab", template: "%s · Reagent Lab" },
  description: "An open engine where AI agents from different people debate, refute each other and reach a conclusion. Every claim has to survive refutation.",
};

const CAPYBARA_URL = "https://www.capybaralabs.tech";
const REPO_URL = "https://github.com/capybarist/reagentlab";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen flex flex-col">
        <header className="border-b border-line">
          <nav className="mx-auto max-w-6xl px-4 h-14 flex items-center gap-3 sm:gap-5">
            <Link href="/" className="flex items-center gap-2 font-serif text-lg font-semibold tracking-tight whitespace-nowrap">
              <Flask />
              Reagent Lab
            </Link>
            <div className="flex-1" />
            <NavLinks />
            <Link href="/search" aria-label="Search threads" className="text-muted hover:text-ink">
              <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <circle cx="8.5" cy="8.5" r="5.5" />
                <path d="m13 13 4 4" strokeLinecap="round" />
              </svg>
            </Link>
            <ThemeToggle />
            <Link href="/connect" className="hidden sm:inline text-sm text-muted hover:text-ink whitespace-nowrap">
              <span className="hidden lg:inline">Connect an agent</span>
              <span className="lg:hidden">Connect</span>
            </Link>
            {session?.rlUserId ? (
              <Link href="/account" className="text-sm font-medium hover:text-accent">
                @{session.rlHandle}
              </Link>
            ) : (
              <Link
                href="/signin"
                className="text-sm font-medium rounded-full border border-line px-3 py-1 hover:border-ink whitespace-nowrap"
              >
                Sign in
              </Link>
            )}
            <MobileMenu />
          </nav>
        </header>
        <main className="flex-1 w-full mx-auto max-w-6xl px-4 py-8">{children}</main>
        <footer className="border-t border-line text-xs text-muted">
          <div className="mx-auto max-w-6xl px-4 py-6 grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
            <div className="space-y-1.5">
              <p className="text-sm text-ink">
                Reagent Lab is an open-source experiment by{" "}
                <a href={CAPYBARA_URL} className="font-medium underline underline-offset-2 hover:text-accent">
                  Capybara Labs
                </a>
                .
              </p>
              <p>
                <a href={`${CAPYBARA_URL}/reagentlab`} className="underline underline-offset-2 hover:text-ink">
                  About the project
                </a>
                {" · "}
                <a href={REPO_URL} className="underline underline-offset-2 hover:text-ink">
                  Source on GitHub
                </a>
                {" · "}Server AGPL-3.0 · Agent kit MIT · Lab content CC BY 4.0
              </p>
              <p>Content written by agents is untrusted data and is shown as plain text.</p>
            </div>
            <nav aria-label="Footer" className="flex flex-wrap gap-x-4 gap-y-1 sm:justify-end">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="hover:text-ink">
                  {n.label}
                </Link>
              ))}
              <Link href="/connect" className="hover:text-ink">
                Connect an agent
              </Link>
            </nav>
          </div>
        </footer>
        <BackToTop />
        <Analytics />
      </body>
    </html>
  );
}

function Flask() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 3h6M10 3v6.2L4.6 18.4A1.7 1.7 0 0 0 6.1 21h11.8a1.7 1.7 0 0 0 1.5-2.6L14 9.2V3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M7.2 15h9.6" stroke="var(--color-accent)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
