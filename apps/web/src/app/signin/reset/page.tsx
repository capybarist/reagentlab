import { redirect } from "next/navigation";
import { emailReset, emailResetRequest } from "@/lib/api";
import { Field, Notice, apiMessage, inputClass, primaryButton } from "@/components/auth-form";

export const metadata = { title: "Reset your password" };

type Params = { email?: string; sent?: string; error?: string };

export default async function ResetPage({ searchParams }: { searchParams: Promise<Params> }) {
  const p = await searchParams;
  return (
    <div className="mx-auto max-w-md space-y-6 pt-8">
      <h1 className="font-serif text-3xl font-semibold">Reset your password</h1>
      {p.error && <Notice tone="error">{p.error}</Notice>}
      {!p.sent ? (
        <form
          className="space-y-3"
          action={async (fd: FormData) => {
            "use server";
            const email = String(fd.get("email") ?? "").trim().toLowerCase();
            try {
              await emailResetRequest({ email });
            } catch (e) {
              redirect(`/signin/reset?${new URLSearchParams({ email, error: apiMessage(e) })}`);
            }
            redirect(`/signin/reset?${new URLSearchParams({ email, sent: "1" })}`);
          }}
        >
          <p className="text-muted">If an account uses this email, we send it a 6-digit code.</p>
          <Field label="Email">
            <input name="email" type="email" required autoComplete="email" defaultValue={p.email} className={inputClass} />
          </Field>
          <button className={primaryButton}>Send me a code</button>
        </form>
      ) : (
        <form
          className="space-y-3"
          action={async (fd: FormData) => {
            "use server";
            const email = p.email ?? "";
            try {
              await emailReset({ email, code: String(fd.get("code") ?? "").trim(), password: String(fd.get("password") ?? "") });
            } catch (e) {
              redirect(`/signin/reset?${new URLSearchParams({ email, sent: "1", error: apiMessage(e) })}`);
            }
            redirect(`/signin?${new URLSearchParams({ reset: "1", email })}`);
          }}
        >
          <p className="text-muted">
            If <span className="text-ink">{p.email}</span> has an account, a code is on its way. It expires in 15 minutes.
          </p>
          <Field label="Code">
            <input
              name="code"
              required
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              autoComplete="one-time-code"
              className={`${inputClass} font-mono tracking-[0.4em] text-lg`}
            />
          </Field>
          <Field label="New password" hint="At least 10 characters.">
            <input name="password" type="password" required minLength={10} autoComplete="new-password" className={inputClass} />
          </Field>
          <button className={primaryButton}>Change my password</button>
        </form>
      )}
    </div>
  );
}
