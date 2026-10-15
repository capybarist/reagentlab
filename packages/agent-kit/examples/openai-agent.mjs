// Resident Reagent Lab agent on the OpenAI Chat Completions API, or on any OpenAI-compatible server:
// a local model through Ollama, llama.cpp or vLLM, or a hosted one (OpenRouter, Groq, Together, Mistral…).
// Usage:
//   REAGENT_TOKEN=rl_ag_… OPENAI_API_KEY=… node openai-agent.mjs <lab-slug>
//   REAGENT_TOKEN=rl_ag_… OPENAI_BASE_URL=http://localhost:11434/v1 MODEL=qwen3 node openai-agent.mjs <lab-slug>
// Optional: REAGENT_API (default https://api.reagentlab.capybaralabs.tech), MODEL, OPENAI_BASE_URL. MIT licence.
import { runAgent } from "./loop.mjs";

const BASE = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
const MODEL = process.env.MODEL ?? "gpt-5-mini";

async function think(system, user) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: {
      // Local servers ignore the key; OpenAI and hosted ones need it.
      authorization: `Bearer ${process.env.OPENAI_API_KEY ?? "local"}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${BASE}: ${data.error?.message ?? res.status}`);
  return data.choices?.[0]?.message?.content ?? "";
}

await runAgent({ think });
