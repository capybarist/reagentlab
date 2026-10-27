import { describe, expect, it } from "vitest";
import { CLAIM_STATUSES } from "@reagentlab/contracts";
import {
  type RefutationState,
  applyRuling,
  assignRole,
  claimTransition,
  rulingBlock,
  rulingTimedOut,
  settleBySilence,
  supportStatus,
} from "../src/index.js";

describe("claimTransition", () => {
  it("un apoyo pasa de open a supported y no toca el resto", () => {
    expect(claimTransition("open", { kind: "support" }).status).toBe("supported");
    for (const s of ["supported", "adopted", "verified"] as const) {
      expect(claimTransition(s, { kind: "support" }).status).toBe(s);
    }
  });

  it("una refutación aceptada tumba el claim salvo si está verificado, que pide poll", () => {
    for (const s of ["open", "supported", "adopted"] as const) {
      expect(claimTransition(s, { kind: "refutation_accepted" })).toEqual({ status: "refuted", failedDelta: 0 });
    }
    expect(claimTransition("verified", { kind: "refutation_accepted" })).toEqual({
      status: "verified",
      failedDelta: 0,
      needsPoll: true,
    });
  });

  it("una refutación rechazada suma una refutación fallida sin cambiar el estado", () => {
    for (const s of ["open", "supported", "adopted", "verified"] as const) {
      expect(claimTransition(s, { kind: "refutation_rejected" })).toEqual({ status: s, failedDelta: 1 });
    }
  });

  it("solo un claim apoyado se adopta por poll", () => {
    expect(claimTransition("supported", { kind: "poll_adopted" }).status).toBe("adopted");
    expect(claimTransition("open", { kind: "poll_adopted" }).status).toBe("open");
  });

  it("un claim apoyado o adoptado pasa a verified; uno sin apoyo, no (ADR-0027, ADR-0044)", () => {
    expect(claimTransition("adopted", { kind: "verified" }).status).toBe("verified");
    expect(claimTransition("supported", { kind: "verified" }).status).toBe("verified");
    for (const s of ["open", "verified", "refuted"] as const) {
      expect(claimTransition(s, { kind: "verified" }).status).toBe(s);
    }
  });

  it("un dictamen provisional vence pasadas las horas de la sala (ADR-0045)", () => {
    const ruledAt = new Date("2026-10-20T10:00:00Z");
    const before = new Date("2026-10-23T09:59:00Z");
    const after = new Date("2026-10-23T10:00:00Z");
    expect(rulingTimedOut({ status: "ruled", ruledAt }, 72, before)).toBe(false);
    expect(rulingTimedOut({ status: "ruled", ruledAt }, 72, after)).toBe(true);
    expect(rulingTimedOut({ status: "pending", ruledAt: null }, 72, after)).toBe(false);
    expect(rulingTimedOut({ status: "accepted", ruledAt }, 72, after)).toBe(false);
  });

  it("refuted es terminal ante cualquier evento", () => {
    for (const kind of ["support", "refutation_accepted", "refutation_rejected", "poll_adopted", "verified"] as const) {
      expect(claimTransition("refuted", { kind })).toEqual({ status: "refuted", failedDelta: 0 });
    }
  });

  it("nunca devuelve un estado desconocido", () => {
    for (const s of CLAIM_STATUSES) {
      for (const kind of ["support", "refutation_accepted", "refutation_rejected", "poll_adopted", "verified"] as const) {
        expect(CLAIM_STATUSES).toContain(claimTransition(s, { kind }).status);
      }
    }
  });
});

describe("dictámenes de refutaciones", () => {
  const pending: RefutationState = {
    status: "pending",
    refuterParty: "refuter",
    claimAuthorParty: "author",
    provisionalVerdict: null,
    provisionalParty: null,
  };
  const ruled = (verdict: "valid" | "invalid"): RefutationState => ({
    ...pending,
    status: "ruled",
    provisionalVerdict: verdict,
    provisionalParty: "v1",
  });

  it("ni el refutador ni el autor del claim pueden dictaminar", () => {
    expect(rulingBlock(pending, "refuter")).toBe("conflict_of_interest");
    expect(rulingBlock(pending, "author")).toBe("conflict_of_interest");
    expect(rulingBlock(pending, "v1")).toBeNull();
  });

  it("quien dio el dictamen provisional no puede confirmarlo él mismo", () => {
    expect(rulingBlock(ruled("valid"), "v1")).toBe("already_ruled");
    expect(rulingBlock(ruled("valid"), "v2")).toBeNull();
  });

  it("las refutaciones en disputa o resueltas no admiten dictámenes", () => {
    for (const status of ["disputed", "accepted", "rejected"] as const) {
      expect(rulingBlock({ ...pending, status }, "v1")).toBe("closed");
    }
  });

  it("el primer dictamen es provisional", () => {
    expect(applyRuling(pending, "v1", "valid")).toEqual({ kind: "provisional", status: "ruled", verdict: "valid" });
  });

  it("un segundo verificador que coincide lo hace firme; uno que discrepa abre disputa", () => {
    expect(applyRuling(ruled("valid"), "v2", "valid")).toEqual({ kind: "final", status: "accepted", verdict: "valid" });
    expect(applyRuling(ruled("invalid"), "v2", "invalid")).toEqual({ kind: "final", status: "rejected", verdict: "invalid" });
    expect(applyRuling(ruled("valid"), "v2", "invalid")).toEqual({ kind: "disputed", status: "disputed" });
  });

  it("applyRuling no acepta dictámenes bloqueados", () => {
    expect(() => applyRuling(pending, "author", "valid")).toThrow();
  });

  it("el silencio de un verificador posterior confirma el dictamen provisional", () => {
    expect(settleBySilence(ruled("valid"))).toEqual({ status: "accepted", verdict: "valid" });
    expect(settleBySilence(ruled("invalid"))).toEqual({ status: "rejected", verdict: "invalid" });
    expect(settleBySilence(pending)).toBeNull();
  });
});

describe("assignRole con claims", () => {
  const base = { postsSinceDigest: 0, digestStaleAfter: 15, hasActiveScribe: false };

  it("prioridad: escriba > verificador > refutador > proponente", () => {
    expect(assignRole({ ...base, postsSinceDigest: 15, rulingsAvailable: 1, refutableClaims: 1 }, null)).toBe("scribe");
    expect(assignRole({ ...base, rulingsAvailable: 1, refutableClaims: 1 }, null)).toBe("verifier");
    expect(assignRole({ ...base, refutableClaims: 1 }, null)).toBe("refuter");
    expect(assignRole(base, null)).toBe("proposer");
  });

  it("no repite el rol del último turno si hay otra opción", () => {
    expect(assignRole({ ...base, rulingsAvailable: 1, refutableClaims: 1 }, "verifier")).toBe("refuter");
    expect(assignRole({ ...base, refutableClaims: 1 }, "refuter")).toBe("proposer");
    expect(assignRole(base, "proposer")).toBe("proposer");
  });

  it("también hay verificador si hay claims que reproducir o revisar (ADR-0027)", () => {
    expect(assignRole({ ...base, verificationsAvailable: 1, refutableClaims: 1 }, null)).toBe("verifier");
    expect(assignRole({ ...base, verificationsAvailable: 1 }, "verifier")).toBe("proposer");
    expect(assignRole({ ...base, verificationsAvailable: 0 }, null)).toBe("proposer");
  });
});

describe("supportStatus (ADR-0028)", () => {
  const counts = [0, 1, 2, 3];

  it("open o supported: apoyado si y solo si hay apoyos y los fallos no superan a las confirmaciones", () => {
    for (const status of ["open", "supported"] as const) {
      for (const supports of counts) {
        for (const confirms of counts) {
          for (const fails of counts) {
            const want = supports > 0 && fails <= confirms ? "supported" : "open";
            expect(supportStatus(status, supports, { confirms, fails })).toBe(want);
          }
        }
      }
    }
  });

  it("no toca lo adoptado, verificado o refutado", () => {
    for (const status of ["adopted", "verified", "refuted"] as const) {
      for (const supports of counts) {
        for (const fails of counts) {
          expect(supportStatus(status, supports, { confirms: 0, fails })).toBe(status);
        }
      }
    }
  });

  it("nunca devuelve un estado desconocido", () => {
    for (const s of CLAIM_STATUSES) expect(CLAIM_STATUSES).toContain(supportStatus(s, 1, { confirms: 0, fails: 1 }));
  });
});
