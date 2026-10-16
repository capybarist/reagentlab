import { describe, expect, it } from "vitest";
import { CLAIM_STATUSES, CLAIM_KINDS, VERIFICATION_OUTCOMES } from "@reagentlab/contracts";
import {
  checkSteps,
  readyForGreen,
  requiredFor,
  stepCoverage,
  tally,
  verificationBlock,
  verificationKindOf,
} from "../src/index.js";

const RULES = { min_reproductions: 2, min_derivation_checks: 2 };

describe("qué se verifica de un claim (ADR-0027)", () => {
  it("un cálculo con artefacto se reproduce; una derivación se revisa; lo demás no se verifica", () => {
    for (const kind of CLAIM_KINDS) {
      for (const hasArtifact of [true, false]) {
        const expected =
          kind === "computation" && hasArtifact ? "artifact" : kind === "derivation" ? "derivation" : null;
        expect(verificationKindOf({ kind, hasArtifact }, RULES)).toBe(expected);
      }
    }
  });

  it("con el mínimo a 0 la sala desactiva ese camino al verde", () => {
    expect(verificationKindOf({ kind: "computation", hasArtifact: true }, { ...RULES, min_reproductions: 0 })).toBeNull();
    expect(verificationKindOf({ kind: "derivation", hasArtifact: false }, { ...RULES, min_derivation_checks: 0 })).toBeNull();
    expect(requiredFor("artifact", { min_reproductions: 3, min_derivation_checks: 1 })).toBe(3);
    expect(requiredFor("derivation", { min_reproductions: 3, min_derivation_checks: 1 })).toBe(1);
  });
});

describe("quién puede verificar", () => {
  const claim = { status: "adopted" as const, authorParty: "author", kind: "artifact" as const };

  it("otra parte, una sola vez, en un claim vivo", () => {
    expect(verificationBlock(claim, "other", [])).toBeNull();
    expect(verificationBlock(claim, "other", ["other"])).toBe("already_verified");
    expect(verificationBlock(claim, "author", [])).toBe("conflict_of_interest");
    expect(verificationBlock({ ...claim, kind: null }, "other", [])).toBe("not_verifiable");
  });

  it("solo open, supported y adopted admiten verificaciones", () => {
    for (const status of CLAIM_STATUSES) {
      const block = verificationBlock({ ...claim, status }, "other", []);
      expect(block === null).toBe(["open", "supported", "adopted"].includes(status));
      if (block) expect(block).toBe("closed");
    }
  });
});

describe("recuento y verde", () => {
  const v = (party: string, outcome: (typeof VERIFICATION_OUTCOMES)[number]) => ({ party, outcome });

  it("cuenta cada parte una vez", () => {
    expect(tally([v("a", "confirms"), v("a", "fails"), v("b", "fails"), v("c", "inconclusive")])).toEqual({
      confirms: 1,
      fails: 1,
      inconclusive: 1,
    });
  });

  it("verde con confirmaciones netas suficientes y solo si está adoptado", () => {
    const two = tally([v("a", "confirms"), v("b", "confirms")]);
    expect(readyForGreen("adopted", two, 2)).toBe(true);
    for (const s of CLAIM_STATUSES.filter((s) => s !== "adopted")) expect(readyForGreen(s, two, 2)).toBe(false);
  });

  it("un fallo resta una confirmación y lo no concluyente no cuenta", () => {
    expect(readyForGreen("adopted", tally([v("a", "confirms"), v("b", "confirms"), v("c", "fails")]), 2)).toBe(false);
    expect(
      readyForGreen("adopted", tally([v("a", "confirms"), v("b", "confirms"), v("c", "fails"), v("d", "confirms")]), 2),
    ).toBe(true);
    expect(readyForGreen("adopted", tally([v("a", "confirms"), v("b", "inconclusive")]), 2)).toBe(false);
  });

  it("con requisito 0 nunca hay verde por esta vía", () => {
    expect(readyForGreen("adopted", tally([v("a", "confirms"), v("b", "confirms")]), 0)).toBe(false);
  });
});

describe("pasos revisados en una derivación (ADR-0031)", () => {
  const holds = (step: number) => ({ step, verdict: "holds" as const });
  const ok = (r: ReturnType<typeof checkSteps>) => !("message" in r);

  it("confirmar exige todos los pasos con holds y no vale solo con rerun", () => {
    expect(ok(checkSteps("derivation", { outcome: "confirms", steps_checked: [holds(1), holds(2)] }, 2))).toBe(true);
    expect(ok(checkSteps("derivation", { outcome: "confirms", method: "both", steps_checked: [holds(2), holds(1)] }, 2))).toBe(true);
    expect(ok(checkSteps("derivation", { outcome: "confirms" }, 2))).toBe(false);
    expect(ok(checkSteps("derivation", { outcome: "confirms", steps_checked: [holds(1)] }, 2))).toBe(false);
    expect(ok(checkSteps("derivation", { outcome: "confirms", method: "rerun", steps_checked: [holds(1), holds(2)] }, 2))).toBe(false);
    expect(ok(checkSteps("derivation", { outcome: "confirms", steps_checked: [holds(1), holds(1), holds(2)] }, 2))).toBe(false);
    expect(ok(checkSteps("derivation", { outcome: "confirms", steps_checked: [holds(1), holds(3)] }, 2))).toBe(false);
  });

  it("fallar exige un paso que falla, en steps_checked o en step, y lo devuelve", () => {
    expect(checkSteps("derivation", { outcome: "fails", step: 2 }, 3)).toMatchObject({ step: 2, steps: [{ step: 2, verdict: "fails" }] });
    expect(
      checkSteps("derivation", { outcome: "fails", steps_checked: [holds(1), { step: 3, verdict: "fails" }] }, 3),
    ).toMatchObject({ step: 3, method: "read" });
    expect(ok(checkSteps("derivation", { outcome: "fails" }, 3))).toBe(false);
    expect(ok(checkSteps("derivation", { outcome: "fails", step: 2, steps_checked: [holds(2)] }, 3))).toBe(false);
    expect(ok(checkSteps("derivation", { outcome: "inconclusive", steps_checked: [{ step: 1, verdict: "fails" }] }, 3))).toBe(false);
    expect(checkSteps("derivation", { outcome: "inconclusive" }, 3)).toEqual({ method: "read", step: null, steps: null });
  });

  it("un artefacto no lleva pasos", () => {
    expect(checkSteps("artifact", { outcome: "confirms" }, 0)).toEqual({ method: "rerun", step: null, steps: null });
    expect(ok(checkSteps("artifact", { outcome: "fails", step: 1 }, 0))).toBe(false);
    expect(ok(checkSteps("artifact", { outcome: "fails", steps_checked: [holds(1)] }, 0))).toBe(false);
  });

  it("la cobertura cuenta una vez por parte y por paso", () => {
    expect(
      stepCoverage(2, [
        { party: "a", steps: [holds(1), { step: 2, verdict: "fails" }] },
        { party: "a", steps: [holds(2)] },
        { party: "b", steps: [holds(1), { step: 2, verdict: "not_checked" }] },
        { party: "c", steps: null },
      ]),
    ).toEqual([
      { holds: 2, fails: 0 },
      { holds: 0, fails: 1 },
    ]);
  });
});
