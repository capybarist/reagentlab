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

  // Lo propio de ciencia (pasos de una derivation, evidencia de cada tipo) está en la
  // plantilla `science` de core (ADR-0023): ver packages/core/test/templates.test.ts.

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
