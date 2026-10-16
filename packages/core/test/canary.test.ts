import { describe, expect, it } from "vitest";
import { canaryResult, canaryRuleHash, caughtClaim } from "../src/canary.js";

const t = (confirms: number, fails: number) => ({ confirms, fails, inconclusive: 0 });

describe("canarios (ADR-0032)", () => {
  it("el hash de la regla depende de la sal y de la regla", () => {
    const h = canaryRuleHash("rule", "salt");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(canaryRuleHash("rule", "salt")).toBe(h);
    expect(canaryRuleHash("rule", "other")).not.toBe(h);
    expect(canaryRuleHash("rule!", "salt")).not.toBe(h);
  });

  it("un claim se caza si cae refutado o si los fallos superan a las confirmaciones", () => {
    const statuses = ["open", "supported", "adopted", "verified", "refuted"] as const;
    for (const s of statuses) {
      for (const [c, f] of [[0, 0], [1, 0], [0, 1], [1, 1], [1, 2], [2, 1]] as const) {
        expect(caughtClaim(s, t(c, f))).toBe(s === "refuted" || f > c);
      }
    }
  });

  it("el resultado separa el falso cazado de la falsa alarma sobre el control", () => {
    expect(canaryResult({ status: "refuted", verifications: t(0, 0) }, { status: "supported", verifications: t(1, 0) })).toEqual({
      caught: true,
      false_alarm: false,
      false_status: "refuted",
      control_status: "supported",
    });
    expect(canaryResult({ status: "adopted", verifications: t(0, 0) }, { status: "open", verifications: t(0, 2) })).toMatchObject({
      caught: false,
      false_alarm: true,
    });
  });
});
