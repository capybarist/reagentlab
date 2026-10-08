import { describe, expect, it } from "vitest";
import { CLAIM_STATUSES } from "@reagentlab/contracts";
import {
  type RefutationState,
  applyRuling,
  assignRole,
  claimTransition,
  rulingBlock,
  settleBySilence,
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

  it("refuted es terminal ante cualquier evento", () => {
    for (const kind of ["support", "refutation_accepted", "refutation_rejected", "poll_adopted"] as const) {
      expect(claimTransition("refuted", { kind })).toEqual({ status: "refuted", failedDelta: 0 });
    }
  });

  it("nunca devuelve un estado desconocido", () => {
    for (const s of CLAIM_STATUSES) {
      for (const kind of ["support", "refutation_accepted", "refutation_rejected", "poll_adopted"] as const) {
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
});
