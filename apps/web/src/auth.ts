import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import { upsertUser } from "./lib/api";

/**
 * Login humano (ADR-0005): GitHub en Fase 0. La sesión vive en un JWT cifrado
 * de Auth.js y solo guarda el id de usuario de Reagent Lab.
 *
 * `AUTH_DEV_LOGIN=1` añade un login de desarrollo sin GitHub, solo fuera de
 * producción, para probar el flujo de cuenta en local.
 */
const isProd = process.env.NODE_ENV === "production";
const githubConfigured = Boolean(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET);
// En local, sin OAuth App de GitHub, el login de desarrollo se activa solo.
const devLogin = !isProd && (process.env.AUTH_DEV_LOGIN === "1" || !githubConfigured);

const providers: NextAuthConfig["providers"] = githubConfigured || isProd ? [GitHub] : [];
if (devLogin) {
  providers.push(
    Credentials({
      id: "dev",
      name: "Local dev account",
      credentials: { handle: { label: "Handle", type: "text" } },
      async authorize(c) {
        const handle = String(c?.handle ?? "").trim() || "dev";
        if (!/^[a-z0-9-]{1,39}$/i.test(handle)) return null;
        return { id: `dev:${handle}`, name: handle };
      },
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  secret: process.env.AUTH_SECRET ?? (isProd ? undefined : "local-dev-only-secret-not-for-production"),
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/signin" },
  callbacks: {
    async jwt({ token, account, profile, user }) {
      // Solo en el inicio de sesión: registra al humano en la API y guarda su id.
      if (account?.provider === "github" && profile) {
        const p = profile as { id: number | string; login: string; created_at?: string };
        const u = await upsertUser({
          provider: "github",
          provider_id: String(p.id),
          handle: p.login,
          account_created_at: p.created_at,
        });
        token.userId = u.id;
        token.handle = u.handle;
      } else if (account?.provider === "dev" && user?.name) {
        const u = await upsertUser({ provider: "dev", provider_id: user.name, handle: user.name });
        token.userId = u.id;
        token.handle = u.handle;
      }
      return token;
    },
    session({ session, token }) {
      session.rlUserId = token.userId as string | undefined;
      session.rlHandle = token.handle as string | undefined;
      return session;
    },
  },
});

export const devLoginEnabled = devLogin;
export const githubLoginEnabled = githubConfigured || isProd;

declare module "next-auth" {
  interface Session {
    rlUserId?: string;
    rlHandle?: string;
  }
}
