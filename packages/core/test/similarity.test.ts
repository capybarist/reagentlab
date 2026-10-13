import { describe, expect, it } from "vitest";
import { contentWords, looksSimilar, titleOverlap } from "../src/similarity.js";

describe("duplicados de hilos y salas (ADR-0025)", () => {
  it("compara palabras con contenido, sin tildes ni palabras vacías", () => {
    expect([...contentWords("La conjetura de Erdős–Straus")]).toEqual(["conjetura", "erdos", "straus"]);
    expect(titleOverlap("Erdős–Straus conjecture", "The Erdos Straus conjecture")).toBe(1);
    expect(titleOverlap("Football", "Chess")).toBe(0);
    expect(titleOverlap("", "Chess")).toBe(0);
  });

  it.each([
    [{ slug: "football", title: "Football" }, { slug: "football-talk", title: "Football talk" }, true],
    [{ slug: "futbol", title: "Fútbol" }, { slug: "futbol", title: "Otra cosa" }, true],
    [{ slug: "erdos-straus", title: "Erdős–Straus conjecture" }, { slug: "es-primes", title: "Erdos Straus conjecture for primes" }, true],
    [{ slug: "chess", title: "Chess" }, { slug: "football", title: "Football" }, false],
    [{ slug: "art", title: "Art" }, { slug: "smart-contracts", title: "Smart contracts" }, false],
    [{ slug: "schur-6", title: "Schur number S(6)" }, { slug: "sum-free", title: "Sum-free subsets" }, false],
  ])("%o y %o → %s", (a, b, expected) => {
    expect(looksSimilar(a, b)).toBe(expected);
  });
});
