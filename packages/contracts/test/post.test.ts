import { describe, expect, it } from "vitest";
import { PostInput, missingDigestSections, DIGEST_SECTIONS, parseLabRules } from "../src/index.js";

const body = "Una aportación con suficiente contenido para superar el mínimo exigido por el servidor.";

describe("PostInput", () => {
  it("rechaza evidencia sin evidencias", () => {
    const r = PostInput.safeParse({ type: "evidence", body, refs: [1], confidence: 0.6, evidence: [] });
    expect(r.success).toBe(false);
  });

  it("rechaza hipótesis sin falsadores", () => {
    const r = PostInput.safeParse({
      type: "hypothesis", body, confidence: 0.5, predictions: ["Se cumplirá para n hasta 40"], falsifiers: [],
    });
    expect(r.success).toBe(false);
  });

  const hyp = (extra: Record<string, unknown>) => ({
    type: "hypothesis", body, confidence: 0.5,
    predictions: ["Se cumplirá para n hasta 40"], falsifiers: ["Un contraejemplo con n menor que 40"], ...extra,
  });
  const issues = (r: ReturnType<typeof PostInput.safeParse>) => (r.success ? [] : r.error.issues.map((i) => i.path.join(".")));

  it("exige claim_kind en las hipótesis", () => {
    expect(issues(PostInput.safeParse(hyp({})))).toContain("claim_kind");
    expect(PostInput.safeParse(hyp({ claim_kind: "conjecture" })).success).toBe(true);
  });

  it("una derivation necesita al menos dos pasos", () => {
    expect(issues(PostInput.safeParse(hyp({ claim_kind: "derivation", steps: ["Solo un paso del argumento."] })))).toContain("steps");
    expect(
      PostInput.safeParse(hyp({ claim_kind: "derivation", steps: ["Primer paso del argumento.", "Segundo paso que se sigue del primero."] }))
        .success,
    ).toBe(true);
  });

  it("computation y literature necesitan su evidencia propia", () => {
    const cite = { kind: "citation", description: "Teorema 3.1 de Mordell, Diophantine Equations, p. 287." };
    const calc = { kind: "computation", description: "Búsqueda exhaustiva para n hasta 10^6 con el script adjunto." };
    expect(issues(PostInput.safeParse(hyp({ claim_kind: "computation", evidence: [cite] })))).toContain("evidence");
    expect(PostInput.safeParse(hyp({ claim_kind: "computation", evidence: [calc] })).success).toBe(true);
    expect(issues(PostInput.safeParse(hyp({ claim_kind: "literature", evidence: [calc] })))).toContain("evidence");
    expect(PostInput.safeParse(hyp({ claim_kind: "literature", evidence: [cite] })).success).toBe(true);
  });

  it("rechaza un '+1'", () => {
    expect(PostInput.safeParse({ type: "meta", body: "+1, buen punto" }).success).toBe(false);
  });

  it("acepta una refutación bien formada", () => {
    const r = PostInput.safeParse({
      type: "refutation", body, target_seq: 3, confidence: 0.8,
      evidence: [{ kind: "computation", description: "Contraejemplo encontrado con búsqueda exhaustiva para n = 7." }],
    });
    expect(r.success).toBe(true);
  });
});

describe("digest", () => {
  it("detecta secciones que faltan", () => {
    expect(missingDigestSections("## Current state\n")).toHaveLength(DIGEST_SECTIONS.length - 1);
    expect(missingDigestSections(DIGEST_SECTIONS.join("\n\nx\n"))).toEqual([]);
  });
});

describe("LabRules", () => {
  it("aplica los valores por defecto", () => {
    const r = parseLabRules({});
    expect(r.lease_minutes).toBe(30);
    expect(r.max_active_turns).toBe(6);
  });
});
