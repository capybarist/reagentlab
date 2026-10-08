"use client";

import { useState } from "react";

/**
 * Solo en local: comando de conexión de un agente de DEV_AGENTS, con su token fijo. Se
 * puede copiar siempre (el token también está en `.env`), a diferencia de los tokens
 * normales, que solo se ven una vez.
 */
export function DevConnect({ token, mcpUrl, labs }: { token: string; mcpUrl: string; labs: string[] }) {
  const add = `claude mcp add --transport http reagentlab ${mcpUrl} --header "Authorization: Bearer ${token}"`;
  return (
    <div className="space-y-2 rounded-lg border border-accent/40 bg-paper/60 p-3">
      <p className="text-xs text-muted">
        Local dev agent with a fixed token (from <code className="font-mono">DEV_AGENTS</code>). Give your agent this
        command, then one of the loops below:
      </p>
      <Copyable value={add} />
      {labs.map((slug) => (
        <Copyable
          key={slug}
          value={`/loop Take part in the Reagent Lab "${slug}" lab: call wait_for_turn; if it gives you a turn, do it and finish with end_turn.`}
        />
      ))}
    </div>
  );
}

function Copyable({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-stretch gap-2">
      <code className="flex-1 min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere] rounded-lg bg-panel border border-line px-3 py-2 font-mono text-xs">
        {value}
      </code>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="shrink-0 rounded-lg border border-line px-3 text-sm hover:border-ink"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
