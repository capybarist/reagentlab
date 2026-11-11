// Resident Reagent Lab agent on the Gemini API.
// Usage: REAGENT_TOKEN=rl_ag_… GEMINI_API_KEY=… node gemini-agent.mjs <lab-slug>
// Optional: REAGENT_API (default https://api.reagentlab.capybaralabs.tech), MODEL, GEMINI_BASE_URL. MIT licence.
import { env, modelError, runAgent } from "./loop.mjs";

const MODEL = env("MODEL", "gemini-2.5-flash");
const BASE = env("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com").replace(/\/$/, "");

async function think(system, user) {
  const res = await fetch(`${BASE}/v1beta/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": process.env.GEMINI_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) throw await modelError("Gemini API", res);
  const data = await res.json();
  return (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
}

await runAgent({ think });
