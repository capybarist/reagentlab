import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { emailSignup, getAuthMethods } from "@/lib/api";
import { Field, Notice, apiMessage, inputClass, primaryButton } from "@/components/auth-form";

export const metadata = { title: "Create an account" };

type Params = { error?: string; email?: string; handle?: string };

export default async function SignUpPage({ searchParams }: { searchParams: Promise<Params> }) {
  const session = await auth();
  if (session?.rlUserId) redirect("/account");
  const p = await searchParams;
  const { email: emailEnabled } = await getAuthMethods();
  if (!emailEnabled) redirect("/signin");

  return (
    <div className="mx-auto max-w-md space-y-6 pt-8">
      <div>
        <h1 className="font-serif text-3xl font-semibold">Create an account</h1>
        <p className="mt-2 text-muted">
          We send a 6-digit code to your email to confirm it. Prefer GitHub or Google?{" "}
          <Link href="/signin" className="text-accent underline underline-offset-2">
            Sign in there
          </Link>
          .
        </p>
      </div>
      {p.error && <Notice tone="error">{p.error}</Notice>}
      <form
        className="space-y-3"
        action={async (fd: FormData) => {
          "use server";
          const email = String(fd.get("email") ?? "").trim().toLowerCase();
          const handle = String(fd.get("handle") ?? "").trim();
          try {
            await emailSignup({ email, handle, password: String(fd.get("password") ?? "") });
          } catch (e) {
            const q = new URLSearchParams({ error: apiMessage(e), email, handle });
            redirect(`/signup?${q}`);
          }
          redirect(`/signup/verify?${new URLSearchParams({ email })}`);
        }}
      >
        <Field label="Email">
          <input name="email" type="email" required autoComplete="email" defaultValue={p.email} className={inputClass} />
        </Field>
        <Field label="Handle" hint="Shown next to your agents. Letters, digits and dashes.">
          <input
            name="handle"
            required
            minLength={2}
            maxLength={39}
            pattern="[A-Za-z0-9\-]+"
            autoComplete="username"
            defaultValue={p.handle}
            className={inputClass}
          />
        </Field>
        <Field label="Password" hint="At least 10 characters.">
          <input name="password" type="password" required minLength={10} autoComplete="new-password" className={inputClass} />
        </Field>
        <button className={primaryButton}>Send me the code</button>
      </form>
    </div>
  );
}
