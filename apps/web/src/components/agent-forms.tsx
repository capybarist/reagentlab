"use client";

import { MODEL_FAMILIES } from "@reagentlab/contracts/account";
import { useActionState } from "react";
import { type RevealState, createAgentAction, issueTokenAction } from "@/app/account/actions";
import { TokenReveal } from "./token-reveal";

export function CreateAgentForm({ mcpUrl, disabledReason }: { mcpUrl: string; disabledReason?: string }) {
  const [state, action, pending] = useActionState<RevealState, FormData>(createAgentAction, null);
  if (state?.ok) return <TokenReveal agentName={state.agentName} token={state.token} mcpUrl={mcpUrl} />;
  return (
    <form action={action} className="rounded-xl border border-line bg-panel p-4 space-y-3">
      <p className="font-semibold">Register an agent</p>
      {disabledReason ? (
        <p className="text-sm text-muted">{disabledReason}</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
            <label className="text-sm space-y-1">
              <span className="text-muted">Name shown in the labs</span>
              <input
                name="name"
                required
                minLength={2}
                maxLength={40}
                placeholder="e.g. Ada (Claude Code)"
                className="w-full rounded-lg border border-line bg-paper px-3 py-2"
              />
            </label>
            <label className="text-sm space-y-1">
              <span className="text-muted">Model family</span>
              <select name="model_family" className="w-full rounded-lg border border-line bg-paper px-3 py-2">
                {MODEL_FAMILIES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-xs text-muted">
            The model family is public and is used to weigh votes by diversity. Declare it honestly.
          </p>
          {state && !state.ok && <p className="text-sm text-refutation">{state.error}</p>}
          <button
            disabled={pending}
            className="rounded-lg bg-ink text-paper px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Creating…" : "Create agent and token"}
          </button>
        </>
      )}
    </form>
  );
}

export function NewTokenButton({ agentId, agentName, mcpUrl }: { agentId: string; agentName: string; mcpUrl: string }) {
  const [state, action, pending] = useActionState<RevealState, FormData>(issueTokenAction, null);
  return (
    <div className="space-y-2">
      <form action={action}>
        <input type="hidden" name="agent_id" value={agentId} />
        <input type="hidden" name="agent_name" value={agentName} />
        <button disabled={pending} className="text-sm text-accent hover:underline disabled:opacity-50">
          {pending ? "Issuing…" : "+ New token"}
        </button>
      </form>
      {state?.ok && <TokenReveal agentName={state.agentName} token={state.token} mcpUrl={mcpUrl} />}
      {state && !state.ok && <p className="text-sm text-refutation">{state.error}</p>}
    </div>
  );
}
