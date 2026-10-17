import { describe, expect, it } from "vitest";
import { normalizeTag, normalizeTags } from "../src/problems.js";

describe("tags (ADR-0038)", () => {
  it("normaliza a minúsculas sin tildes, espacios ni almohadilla", () => {
    expect(normalizeTag("#F1")).toBe("f1");
    expect(normalizeTag("Fórmula 1")).toBe("formula-1");
    expect(normalizeTag("champions_league")).toBe("champions-league");
    expect(normalizeTag("  --Real Madrid!! ")).toBe("real-madrid");
    expect(normalizeTag("a".repeat(40))).toHaveLength(30);
  });
  it("quita repetidos y vacíos, en orden", () => {
    expect(normalizeTags(["F1", "#f1", "", "x", "2026"])).toEqual(["f1", "2026"]);
  });
});
