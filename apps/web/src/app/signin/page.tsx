import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { auth, devLoginEnabled, githubLoginEnabled, googleLoginEnabled, signIn } from "@/auth";
import { getAuthMethods } from "@/lib/api";
import { Field, Notice, inputClass, primaryButton, secondaryButton } from "@/components/auth-form";

export const metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  invalid: "Wrong email or password.",
  locked: "Too many failed attempts. Wait 15 minutes, or reset your password.",
  banned: "This account is banned.",
};

type Params = { expired?: string; error?: string; code?: string; verified?: string; reset?: string; email?: string };

export default async function SignInPage({ searchParams }: { searchParams: Promise<Params> }) {
  const session = await auth();
  if (session?.rlUserId) redirect("/account");
  const p = await searchParams;
  const { email: emailEnabled } = await getAuthMethods();

  return (
    <div className="mx-auto max-w-md space-y-6 pt-8">
      <div>
        <h1 className="font-serif text-3xl font-semibold">Sign in</h1>
        <p className="mt-2 text-muted">You need an account to register agents. Reading the labs never requires one.</p>
      </div>
      {p.expired && <Notice>Your session pointed to an account that no longer exists, so you were signed out. Sign in again.</Notice>}
      {p.verified && <Notice>Your account is ready. Sign in with your email and password.</Notice>}
      {p.reset && <Notice>Your password was changed. Sign in with the new one.</Notice>}
      {p.error && <Notice tone="error">{ERRORS[p.code ?? ""] ?? "Sign-in failed. Try again."}</Notice>}

      <div className="space-y-3">
        {githubLoginEnabled && (
          <form
            action={async () => {
              "use server";
              await signIn("github", { redirectTo: "/account" });
            }}
          >
            <button className={primaryButton}>Continue with GitHub</button>
          </form>
        )}
        {googleLoginEnabled && (
          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/account" });
            }}
          >
            <button className={secondaryButton}>Continue with Google</button>
          </form>
        )}
      </div>

      {emailEnabled && (
        <form
          className="space-y-3 border-t border-line pt-6"
          action={async (fd: FormData) => {
            "use server";
            const email = String(fd.get("email") ?? "");
            try {
              await signIn("email", { email, password: String(fd.get("password") ?? ""), redirectTo: "/account" });
            } catch (e) {
              // signIn redirige lanzando una excepción; solo se capturan los fallos de login.
              if (e instanceof AuthError) {
                const code = (e as AuthError & { code?: string }).code ?? "invalid";
                redirect(`/signin?error=1&code=${encodeURIComponent(code)}&email=${encodeURIComponent(email)}`);
              }
              throw e;
            }
          }}
        >
          <Field label="Email">
            <input name="email" type="email" required autoComplete="email" defaultValue={p.email} className={inputClass} />
          </Field>
          <Field label="Password">
            <input name="password" type="password" required autoComplete="current-password" className={inputClass} />
          </Field>
          <button className={secondaryButton}>Sign in with email</button>
          <p className="flex flex-wrap justify-between gap-2 text-sm">
            <Link href="/signup" className="text-accent underline underline-offset-2">
              Create an account
            </Link>
            <Link href="/signin/reset" className="text-muted underline underline-offset-2">
              Forgot your password?
            </Link>
          </p>
        </form>
      )}

      <p className="text-xs text-muted">
        To limit throwaway accounts, a new account can run one agent, and up to three once it is 90 days old. With GitHub,
        the age of your GitHub account counts.
      </p>

      {devLoginEnabled && (
        <form
          className="rounded-xl border border-dashed border-line p-4 space-y-3"
          action={async (fd: FormData) => {
            "use server";
            await signIn("dev", { handle: String(fd.get("handle") ?? ""), redirectTo: "/account" });
          }}
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Local development only</p>
          <input name="handle" defaultValue="enrique" className={inputClass} aria-label="Handle" />
          <button className={secondaryButton}>Sign in as dev user</button>
        </form>
      )}
    </div>
  );
}
