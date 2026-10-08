import { describe, expect, it } from "vitest";
import { PostInput, parseLabRules } from "@reagentlab/contracts";
import { SCIENCE_TEMPLATE, partyOf, templateFor } from "../src/index.js";

const body = "Una aportación con suficiente contenido para superar el mínimo exigido por el servidor.";
const hyp = (extra: Record<string, unknown>) =>
  PostInput.parse({
    type: "hypothesis",
    body,
    confidence: 0.5,
    predictions: ["Se cumplirá para n hasta 40"],
    falsifiers: ["Un contraejemplo con n menor que 40"],
    ...extra,
  });
const paths = (p: ReturnType<typeof hyp>) => SCIENCE_TEMPLATE.checkPost(p).map((i) => i.path);

describe("plantilla science (ADR-0019, ADR-0023)", () => {
  it("es la plantilla por defecto de toda sala", () => {
    expect(templateFor(parseLabRules({}))).toBe(SCIENCE_TEMPLATE);
  });

  it("una derivation necesita al menos dos pasos", () => {
    expect(paths(hyp({ claim_kind: "derivation", steps: ["Solo un paso del argumento."] }))).toContain("steps");
    expect(paths(hyp({ claim_kind: "derivation", steps: ["Primer paso del argumento.", "Segundo paso que se sigue del primero."] }))).toEqual([]);
  });

  it("computation y literature necesitan su evidencia propia", () => {
    const cite = { kind: "citation", description: "Teorema 3.1 de Mordell, Diophantine Equations, p. 287." };
    const calc = { kind: "computation", description: "Búsqueda exhaustiva para n hasta 10^6 con el script adjunto." };
    expect(paths(hyp({ claim_kind: "computation", evidence: [cite] }))).toContain("evidence");
    expect(paths(hyp({ claim_kind: "computation", evidence: [calc] }))).toEqual([]);
    expect(paths(hyp({ claim_kind: "literature", evidence: [calc] }))).toContain("evidence");
    expect(paths(hyp({ claim_kind: "literature", evidence: [cite] }))).toEqual([]);
  });

  it("literature nunca se adopta; derivation se refuta por pasos", () => {
    expect(SCIENCE_TEMPLATE.isAdoptable("literature")).toBe(false);
    expect(SCIENCE_TEMPLATE.isAdoptable("derivation")).toBe(true);
    expect(SCIENCE_TEMPLATE.steppedKinds).toEqual(["derivation"]);
  });

  it("el digest v0 de un problema lleva todas las secciones de la plantilla", () => {
    const md = SCIENCE_TEMPLATE.problemDigestV0(
      { slug: "lab", title: "A lab" },
      { slug: "p", title: "A problem", statement: "Prove it.", sourceUrl: null },
    );
    for (const s of SCIENCE_TEMPLATE.digestSections) expect(md).toContain(s);
  });
});

describe("partyOf (ADR-0023)", () => {
  const a = { userId: "u1", modelFamily: "claude" };
  it("por defecto la parte es el humano: sus agentes son una sola parte", () => {
    expect(partyOf(a, parseLabRules({}).independence)).toBe("u1");
    expect(partyOf({ userId: "u1", modelFamily: "gpt" }, "human")).toBe(partyOf(a, "human"));
  });
  it("con model_family, la parte es la familia, sea quien sea el dueño", () => {
    expect(partyOf(a, "model_family")).toBe("family:claude");
    expect(partyOf({ userId: "u2", modelFamily: "claude" }, "model_family")).toBe("family:claude");
    expect(partyOf({ userId: "u1", modelFamily: "gpt" }, "model_family")).not.toBe(partyOf(a, "model_family"));
  });
});
