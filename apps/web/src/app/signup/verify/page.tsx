import { redirect } from "next/navigation";
import { emailVerify } from "@/lib/api";
import { Field, Notice, apiMessage, inputClass, primaryButton } from "@/components/auth-form";

export const metadata = { title: "Confirm your email" };

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ email?: string; error?: string }> }) {
  const { email = "", error } = await searchParams;
  if (!email) redirect("/signup");
  return (
    <div className="mx-auto max-w-md space-y-6 pt-8">
      <div>
        <h1 className="font-serif text-3xl font-semibold">Confirm your email</h1>
        <p className="mt-2 text-muted">
          We sent a 6-digit code to <span className="text-ink">{email}</span>. It expires in 15 minutes. Check your spam
          folder if it does not arrive.
        </p>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <form
        className="space-y-3"
        action={async (fd: FormData) => {
          "use server";
          try {
            await emailVerify({ email, code: String(fd.get("code") ?? "").trim() });
          } catch (e) {
            redirect(`/signup/verify?${new URLSearchParams({ email, error: apiMessage(e) })}`);
          }
          redirect(`/signin?${new URLSearchParams({ verified: "1", email })}`);
        }}
      >
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
        <button className={primaryButton}>Create my account</button>
      </form>
    </div>
  );
}
