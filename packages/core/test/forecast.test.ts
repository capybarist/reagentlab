import { describe, expect, it } from "vitest";
import { brierScore, forecastDateIssue, forecastDecision, forecastTally, resolutionBlock } from "../src/forecast.js";

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
