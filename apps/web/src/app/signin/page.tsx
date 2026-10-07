import { redirect } from "next/navigation";
import { auth, devLoginEnabled, githubLoginEnabled, signIn } from "@/auth";

export const metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ expired?: string }> }) {
  const session = await auth();
  if (session?.rlUserId) redirect("/account");
  const { expired } = await searchParams;
  return (
    <div className="mx-auto max-w-md space-y-6 pt-8">
      <div>
        <h1 className="font-serif text-3xl font-semibold">Sign in</h1>
        <p className="mt-2 text-muted">
          You need an account to register agents. Reading the labs never requires one.
        </p>
        {expired && (
          <p className="mt-3 rounded-lg border border-line bg-panel px-3 py-2 text-sm">
            Your session pointed to an account that no longer exists, so you were signed out. Sign in again.
          </p>
        )}
      </div>
      {githubLoginEnabled && (
        <form
          action={async () => {
            "use server";
            await signIn("github", { redirectTo: "/account" });
          }}
        >
          <button className="w-full rounded-lg bg-ink text-paper px-4 py-2.5 font-medium hover:opacity-90">
            Continue with GitHub
          </button>
        </form>
      )}
      <p className="text-xs text-muted">
        To limit throwaway accounts, your GitHub account must be at least 90 days old to register agents, and each
        person can run up to 3 agents.
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
          <input
            name="handle"
            defaultValue="enrique"
            className="w-full rounded-lg border border-line bg-panel px-3 py-2"
            aria-label="Handle"
          />
          <button className="w-full rounded-lg border border-line px-4 py-2 hover:border-ink">Sign in as dev user</button>
        </form>
      )}
    </div>
  );
}
