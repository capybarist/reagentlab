import NextAuth, { CredentialsSignin, type NextAuthConfig, type Session } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import { ApiError, emailLogin, upsertUser } from "./lib/api";

/**
 * Login humano (ADR-0005, ADR-0022): GitHub, Google (si hay credenciales) y email con
 * contraseña, que comprueba la API. La sesión vive en un JWT cifrado de Auth.js y solo
 * guarda el id de usuario de Reagent Lab.
 *
 * `AUTH_DEV_LOGIN=1` añade un login de desarrollo sin GitHub, solo fuera de
 * producción, para probar el flujo de cuenta en local.
 */
const isProd = process.env.NODE_ENV === "production";
const githubConfigured = Boolean(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET);
// En local, sin OAuth App de GitHub, el login de desarrollo se activa solo.
const devLogin = !isProd && (process.env.AUTH_DEV_LOGIN === "1" || !githubConfigured);

const googleConfigured = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

/** El motivo llega a /signin como `?code=` para mostrar un mensaje concreto. */
class EmailSignInError extends CredentialsSignin {
  constructor(code: string) {
    super();
    this.code = code;
  }
}

const providers: NextAuthConfig["providers"] = githubConfigured || isProd ? [GitHub] : [];
if (googleConfigured) providers.push(Google);
providers.push(
  Credentials({
    id: "email",
    name: "Email",
    credentials: { email: { type: "email" }, password: { type: "password" } },
    async authorize(c) {
      try {
        const u = await emailLogin({ email: String(c?.email ?? ""), password: String(c?.password ?? "") });
        return { id: u.id, name: u.handle };
      } catch (e) {
        if (e instanceof ApiError) throw new EmailSignInError(e.body.code === "TOO_MANY_REQUESTS" ? "locked" : e.body.code === "USER_BANNED" ? "banned" : "invalid");
        throw e;
      }
    },
  }),
);
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
        token.identity = { provider: "github", provider_id: String(p.id), handle: p.login };
      } else if (account?.provider === "google" && profile?.sub) {
        const email = typeof profile.email === "string" ? profile.email : "";
        const u = await upsertUser({ provider: "google", provider_id: profile.sub, handle: email.split("@")[0] || "user" });
        token.userId = u.id;
        token.handle = u.handle;
        token.identity = { provider: "google", provider_id: profile.sub, handle: u.handle };
      } else if (account?.provider === "email" && user?.id) {
        // Sin identidad guardada: si la cuenta desapareciera, la sesión se cierra (no hay contraseña que reusar).
        token.userId = user.id;
        token.handle = user.name;
      } else if (account?.provider === "dev" && user?.name) {
        const u = await upsertUser({ provider: "dev", provider_id: user.name, handle: user.name });
        token.userId = u.id;
        token.handle = u.handle;
        token.identity = { provider: "dev", provider_id: user.name, handle: user.name };
      }
      return token;
    },
    session({ session, token }) {
      session.rlUserId = token.userId as string | undefined;
      session.rlHandle = token.handle as string | undefined;
      session.rlIdentity = token.identity as Session["rlIdentity"];
      return session;
    },
  },
});

export const devLoginEnabled = devLogin;
export const githubLoginEnabled = githubConfigured || isProd;
export const googleLoginEnabled = googleConfigured;

declare module "next-auth" {
  interface Session {
    rlUserId?: string;
    rlHandle?: string;
    /** Con quién entró: permite volver a registrarlo si la base se ha recreado. */
    rlIdentity?: { provider: "github" | "google" | "dev"; provider_id: string; handle: string };
  }
}
