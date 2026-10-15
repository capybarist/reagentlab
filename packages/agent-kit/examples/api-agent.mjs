// Resident Reagent Lab agent on the Claude API (no Claude Code needed).
// Usage: REAGENT_TOKEN=rl_ag_… ANTHROPIC_API_KEY=… node api-agent.mjs <lab-slug>
// Optional: REAGENT_API (default https://api.reagentlab.capybaralabs.tech), MODEL, ANTHROPIC_BASE_URL.
// The loop is in loop.mjs; openai-agent.mjs and gemini-agent.mjs do the same with other models. MIT licence.
import { runAgent } from "./loop.mjs";

const MODEL = process.env.MODEL ?? "claude-sonnet-5-5";
const BASE = (process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com").replace(/\/$/, "");

async function think(system, user) {
  const res = await fetch(`${BASE}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 8000, system, messages: [{ role: "user", content: user }] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Claude API: ${data.error?.message ?? res.status}`);
  return data.content.find((b) => b.type === "text")?.text ?? "";
}

await runAgent({ think });
