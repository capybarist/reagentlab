import { describe, expect, it } from "vitest";
import { type TallyVote, adoptionDue, disputeDue, labStatusFor, tallyPoll, voteBlock, voteWeight } from "../src/index.js";

const opts = { familyCap: 0.3, minFamilies: 3 };
const v = (userId: string, modelFamily: string, stance: "yes" | "no", weight = 1): TallyVote => ({
  userId,
  modelFamily,
  stance,
  weight,
});

describe("tallyPoll", () => {
  it("sin al menos tres familias no hay quórum aunque todos voten igual", () => {
    const r = tallyPoll([v("a", "claude", "yes"), v("b", "gpt", "yes"), v("c", "gpt", "yes")], opts);
    expect(r).toMatchObject({ outcome: "no_quorum", families: 2, voters: 3 });
  });

  it("decide por mayoría ponderada con tres familias", () => {
    const r = tallyPoll([v("a", "claude", "yes"), v("b", "gpt", "yes"), v("c", "gemini", "no")], opts);
    expect(r.outcome).toBe("yes");
    expect(r.weighted.yes).toBeGreaterThan(r.weighted.no);
  });

  it("una familia que domina no decide sola: su peso se limita al tope", () => {
    // 6 votos claude a favor contra 1 gpt y 1 gemini en contra. Sin tope ganaría `yes` 6-2.
    const votes = [
      ...["a", "b", "c", "d", "e", "f"].map((u) => v(u, "claude", "yes")),
      v("g", "gpt", "no"),
      v("h", "gemini", "no"),
    ];
    const r = tallyPoll(votes, opts);
    // total = 8; tope = 0.3 * 8 = 2.4 para claude; gpt y gemini (1 cada una) no superan el tope.
    expect(r.weighted).toEqual({ yes: 2.4, no: 2 });
    expect(r.outcome).toBe("yes");
    const r2 = tallyPoll([...votes, v("i", "mistral", "no")], opts);
    expect(r2.outcome).toBe("no");
  });

  it("un humano cuenta una vez aunque aparezca con varios agentes", () => {
    const r = tallyPoll([v("a", "claude", "yes"), v("a", "gpt", "yes"), v("b", "gemini", "no"), v("c", "mistral", "no")], opts);
    expect(r.voters).toBe(3);
    expect(r.outcome).toBe("no");
  });

  it("el empate no adopta", () => {
    const r = tallyPoll(
      [v("a", "claude", "yes"), v("b", "gpt", "no"), v("c", "gemini", "yes"), v("d", "mistral", "no")],
      opts,
    );
    expect(r.outcome).toBe("no");
  });

  it("sin votos no hay quórum", () => {
    expect(tallyPoll([], opts)).toEqual({ outcome: "no_quorum", weighted: { yes: 0, no: 0 }, voters: 0, families: 0 });
  });
});

describe("voteWeight y voteBlock", () => {
  it("el peso se queda entre 0,5 y 1,5", () => {
    expect(voteWeight(0)).toBe(1);
    expect(voteWeight(-1000)).toBe(0.5);
    expect(voteWeight(1000)).toBe(1.5);
  });

  it("las partes no votan y nadie vota dos veces", () => {
    expect(voteBlock(["author"], "author", false)).toBe("party_to_the_case");
    expect(voteBlock(["author"], "x", true)).toBe("already_voted");
    expect(voteBlock(["author"], "x", false)).toBeNull();
  });
});

describe("cuándo se abre un poll", () => {
  const now = new Date("2026-10-10T00:00:00Z");
  const base = { minFailed: 2, hasOpenRefutation: false, hasOpenPoll: false, lastPoll: null, pollHours: 24, now };
  const supported = { status: "supported" as const, failedRefutations: 2 };

  it("adopción: claim apoyado que ha resistido bastantes refutaciones y sin nada abierto", () => {
    expect(adoptionDue(supported, base)).toBe(true);
    expect(adoptionDue({ ...supported, failedRefutations: 1 }, base)).toBe(false);
    expect(adoptionDue({ ...supported, status: "open" }, base)).toBe(false);
    expect(adoptionDue(supported, { ...base, hasOpenRefutation: true })).toBe(false);
    expect(adoptionDue(supported, { ...base, hasOpenPoll: true })).toBe(false);
  });

  it("tras un `no` solo se repite si el claim ha resistido más refutaciones", () => {
    const lastPoll = { outcome: "no" as const, closesAt: new Date("2026-10-01T00:00:00Z"), failedSnapshot: 2 };
    expect(adoptionDue(supported, { ...base, lastPoll })).toBe(false);
    expect(adoptionDue({ ...supported, failedRefutations: 3 }, { ...base, lastPoll })).toBe(true);
  });

  it("tras `no_quorum` se repite pasado otro periodo", () => {
    const closesAt = new Date(now.getTime() - 12 * 3_600_000);
    const lastPoll = { outcome: "no_quorum" as const, closesAt, failedSnapshot: 2 };
    expect(adoptionDue(supported, { ...base, lastPoll })).toBe(false);
    expect(adoptionDue(supported, { ...base, lastPoll, now: new Date(now.getTime() + 13 * 3_600_000) })).toBe(true);
    expect(disputeDue({ hasOpenPoll: false, lastPoll, pollHours: 24, now })).toBe(false);
    expect(disputeDue({ hasOpenPoll: false, lastPoll: null, pollHours: 24, now })).toBe(true);
  });
});

describe("labStatusFor", () => {
  it("verde con un claim verificado, amarillo con uno adoptado, rojo si no", () => {
    expect(labStatusFor({ verified: 1, adopted: 2 })).toBe("green");
    expect(labStatusFor({ adopted: 1, refuted: 3 })).toBe("yellow");
    expect(labStatusFor({ supported: 4 })).toBe("red");
    expect(labStatusFor({})).toBe("red");
  });
});
