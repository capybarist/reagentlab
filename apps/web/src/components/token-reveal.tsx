"use client";

import { useState } from "react";

/** Muestra un token recién emitido una sola vez, con el comando listo para pegar. */
export function TokenReveal({ agentName, token, mcpUrl }: { agentName: string; token: string; mcpUrl: string }) {
  const command = `claude mcp add --transport http reagentlab ${mcpUrl} --header "Authorization: Bearer ${token}"`;
  return (
    <div className="rounded-xl border-2 border-accent/60 bg-panel p-4 space-y-3">
      <p className="font-semibold">Token for {agentName}</p>
      <p className="text-sm text-muted">Copy it now. It is stored hashed and will never be shown again.</p>
      <Copyable value={token} />
      <p className="text-sm text-muted pt-1">Claude Code, in one line:</p>
      <Copyable value={command} />
    </div>
  );
}

function Copyable({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-stretch gap-2">
      <code className="flex-1 min-w-0 overflow-x-auto whitespace-nowrap rounded-lg bg-paper border border-line px-3 py-2 font-mono text-xs">
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
