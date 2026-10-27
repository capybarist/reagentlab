import { describe, expect, it } from "vitest";
import {
  answerKey,
  answersQuestion,
  brierScore,
  currentPoints,
  forecastDateIssue,
  forecastDecision,
  forecastTally,
  hasConsensus,
  median,
  medianHistory,
  resolutionBlock,
  timeWeightedBrier,
  updateBlock,
} from "../src/forecast.js";
import { labStatusFor } from "../src/polls.js";

const now = new Date("2026-10-15T12:00:00Z");
const day = 24 * 60 * 60 * 1000;

describe("pronósticos (ADR-0029)", () => {
  it("bloquea a quien no puede resolver, en orden", () => {
    const due = { resolvesAt: new Date(now.getTime() - day), resolution: null, authorParty: "a" };
    expect(resolutionBlock({ ...due, resolvesAt: null }, "b", [], now)).toBe("not_a_forecast");
    expect(resolutionBlock({ ...due, resolution: "yes" }, "b", [], now)).toBe("resolved");
    expect(resolutionBlock({ ...due, resolvesAt: new Date(now.getTime() + day) }, "b", [], now)).toBe("not_due");
    expect(resolutionBlock(due, "a", [], now)).toBe("conflict_of_interest");
    expect(resolutionBlock(due, "b", ["b"], now)).toBe("already_resolved");
    expect(resolutionBlock(due, "b", ["c"], now)).toBeNull();
    expect(resolutionBlock({ ...due, resolvesAt: now }, "b", [], now)).toBeNull(); // vence justo ahora
  });

  it("cuenta cada parte una vez", () => {
    expect(
      forecastTally([
        { party: "a", outcome: "yes" },
        { party: "a", outcome: "no" },
        { party: "b", outcome: "no" },
        { party: "c", outcome: "void" },
      ]),
    ).toEqual({ yes: 1, no: 1, void: 1 });
  });

  it("decide cuando un resultado saca la ventaja pedida a todos los demás", () => {
    expect(forecastDecision({ yes: 1, no: 0, void: 0 }, 2)).toBeNull();
    expect(forecastDecision({ yes: 2, no: 0, void: 0 }, 2)).toBe("yes");
    expect(forecastDecision({ yes: 2, no: 1, void: 0 }, 2)).toBeNull();
    expect(forecastDecision({ yes: 3, no: 1, void: 0 }, 2)).toBe("yes");
    expect(forecastDecision({ yes: 0, no: 0, void: 2 }, 2)).toBe("void");
    expect(forecastDecision({ yes: 1, no: 0, void: 0 }, 1)).toBe("yes");
    expect(forecastDecision({ yes: 1, no: 1, void: 0 }, 1)).toBeNull();
  });

  it("puntúa con Brier solo lo resuelto yes o no", () => {
    expect(brierScore(0.7, "yes")).toBeCloseTo(0.09);
    expect(brierScore(0.7, "no")).toBeCloseTo(0.49);
    expect(brierScore(0.7, "void")).toBeNull();
    expect(brierScore(0.7, null)).toBeNull();
    expect(brierScore(null, "yes")).toBeNull();
  });

  it("exige fecha futura y dentro del horizonte", () => {
    expect(forecastDateIssue(new Date(now.getTime() + 30 * 60 * 1000), now, 730)).toMatch(/una hora/);
    expect(forecastDateIssue(new Date(now.getTime() + 731 * day), now, 730)).toMatch(/730/);
    expect(forecastDateIssue(new Date(now.getTime() + 30 * day), now, 730)).toBeNull();
  });
});

describe("hilos de pronóstico que concluyen (ADR-0043)", () => {
  const at = (d: number) => new Date(now.getTime() + d * day);

  it("antes de la fecha solo se resuelve con early", () => {
    const open = { resolvesAt: at(5), resolution: null, authorParty: "a" };
    expect(resolutionBlock(open, "b", [], now)).toBe("not_due");
    expect(resolutionBlock(open, "b", [], now, true)).toBeNull();
    expect(resolutionBlock(open, "a", [], now, true)).toBe("conflict_of_interest");
  });

  it("solo se actualiza un pronóstico abierto y antes de su fecha", () => {
    expect(updateBlock({ resolvesAt: null, resolution: null }, now)).toBe("not_a_forecast");
    expect(updateBlock({ resolvesAt: at(1), resolution: "yes" }, now)).toBe("resolved");
    expect(updateBlock({ resolvesAt: at(0), resolution: null }, now)).toBe("past_due");
    expect(updateBlock({ resolvesAt: at(1), resolution: null }, now)).toBeNull();
  });

  it("agrupa respuestas sin acentos, mayúsculas ni espacios de más", () => {
    expect(answerKey("  Sergio  Pérez ")).toBe("sergio perez");
    expect(answerKey("YES")).toBe("yes");
  });

  it("un `yes` responde la pregunta; en sí o no, también un `no`; `void` nunca", () => {
    expect(answersQuestion("Antonelli", "yes")).toBe(true);
    expect(answersQuestion("Antonelli", "no")).toBe(false);
    expect(answersQuestion("Yes", "no")).toBe(true);
    expect(answersQuestion("no", "void")).toBe(false);
    expect(answersQuestion(null, "yes")).toBe(false);
  });

  it("la cifra vigente de cada parte es la última", () => {
    const pts = [
      { party: "a", probability: 0.8, at: at(0) },
      { party: "b", probability: 0.6, at: at(1) },
      { party: "a", probability: 0.5, at: at(2) },
    ];
    expect(currentPoints(pts).map((p) => [p.party, p.probability])).toEqual([
      ["a", 0.5],
      ["b", 0.6],
    ]);
    expect(medianHistory(pts).map((h) => h.median)).toEqual([0.8, 0.7, 0.55]);
  });

  it("mediana y acuerdo", () => {
    expect(median([])).toBe(0);
    expect(median([0.2, 0.9, 0.5])).toBe(0.5);
    expect(median([0.2, 0.4])).toBeCloseTo(0.3);
    expect(hasConsensus([0.7], 2, 0.2)).toBe(false);
    expect(hasConsensus([0.7, 0.9], 2, 0.2)).toBe(true);
    expect(hasConsensus([0.6, 0.9], 2, 0.2)).toBe(false);
  });

  it("Brier ponderado por el tiempo que estuvo vigente cada cifra", () => {
    const pts = [
      { probability: 0.9, at: at(0) },
      { probability: 0.5, at: at(3) },
    ];
    // 0.9 tres días y 0.5 uno: (3·0.01 + 1·0.25) / 4.
    expect(timeWeightedBrier(pts, at(4), "yes")).toBeCloseTo(0.07);
    // Una sola cifra: el Brier de siempre.
    expect(timeWeightedBrier([pts[0]!], at(4), "no")).toBeCloseTo(brierScore(0.9, "no")!);
    // Las cifras posteriores al fin no cuentan.
    expect(timeWeightedBrier(pts, at(3), "yes")).toBeCloseTo(0.01);
    expect(timeWeightedBrier(pts, at(4), "void")).toBeNull();
    expect(timeWeightedBrier([], at(4), "yes")).toBeNull();
  });

  it("el estado del hilo: verde si se respondió, amarillo si hay acuerdo", () => {
    expect(labStatusFor({}, 0, { answered: true, consensus: false })).toBe("green");
    expect(labStatusFor({}, 0, { answered: false, consensus: true })).toBe("yellow");
    expect(labStatusFor({ open: 3 }, 0, { answered: false, consensus: false })).toBe("red");
  });
});
