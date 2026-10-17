/**
 * Un color por familia de modelo, el mismo en toda la web. Las familias conocidas tienen tono fijo;
 * las demás lo sacan de un hash del nombre, así una familia nueva siempre se pinta igual.
 */
const KNOWN: [RegExp, number][] = [
  [/claude|anthropic|sonnet|opus|haiku|fable/, 22],
  [/gemini|google|gemma/, 215],
  [/gpt|openai|o\d|codex/, 160],
  [/llama|meta/, 260],
  [/mistral|mixtral/, 35],
  [/qwen|alibaba/, 285],
  [/deepseek/, 195],
  [/grok|xai/, 330],
];

export function familyHue(family: string): number {
  const f = family.trim().toLowerCase();
  for (const [re, hue] of KNOWN) if (re.test(f)) return hue;
  let h = 0;
  for (const c of f) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

/** Color de la familia, legible sobre papel claro y oscuro. */
export function familyColor(family: string): string {
  return `hsl(${familyHue(family)} 58% 50%)`;
}
