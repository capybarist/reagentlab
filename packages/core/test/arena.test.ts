import { describe, expect, it } from "vitest";
import type { ArenaScore, ClaimStatus } from "@reagentlab/contracts";
import {
  ARENA_POINTS,
  championOf,
  eliminate,
  placement,
  scoreRound,
  tournamentOver,
  trapCommitment,
  trapIssues,
  type ScoringEntry,
} from "../src/arena.js";

const T0 = new Date("2026-10-18T10:00:00Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
const entry = (id: string, joined = 0): ScoringEntry => ({ id, party: `p-${id}`, agentName: id, modelFamily: "f", joinedAt: at(joined) });
const none = (): ClaimStatus | null => "open";

describe("scoreRound (ADR-0040)", () => {
  const entries = [entry("a"), entry("b", 1), entry("c", 2)];
  const traps = [
    { entryId: "a", seqs: [1, 2] as [number, number], brokenSeq: 1, brokenStep: 2 },
    { entryId: "b", seqs: [3, 4] as [number, number], brokenSeq: 4, brokenStep: null },
    { entryId: "c", seqs: [5, 6] as [number, number], brokenSeq: 5, brokenStep: 1 },
  ];
  const byId = (s: ArenaScore[], id: string) => s.find((x) => x.entry_id === id)!;

  it("caza en el paso comprometido, falsa alarma en la correcta y supervivencia", () => {
    const { scores, traps: out } = scoreRound(
      entries,
      traps,
      [
        { party: "p-b", targetSeq: 1, targetStep: 2, createdAt: at(10) }, // caza a
        { party: "p-b", targetSeq: 1, targetStep: 2, createdAt: at(11) }, // repetida: no suma
        { party: "p-c", targetSeq: 1, targetStep: 1, createdAt: at(12) }, // paso equivocado: nada
        { party: "p-a", targetSeq: 3, targetStep: null, createdAt: at(13) }, // acusa la correcta de b
        { party: "p-x", targetSeq: 5, targetStep: 1, createdAt: at(14) }, // no inscrito: no cuenta
        { party: "p-c", targetSeq: 6, targetStep: null, createdAt: at(15) }, // su propia trampa: no cuenta
      ],
      none,
    );
    expect(byId(scores, "b")).toMatchObject({ score: ARENA_POINTS.catch + ARENA_POINTS.survived, catches: 1, survived: 1 });
    expect(byId(scores, "a")).toMatchObject({ score: ARENA_POINTS.false_alarm, false_alarms: 1, survived: 0 });
    expect(byId(scores, "c")).toMatchObject({ score: ARENA_POINTS.survived, catches: 0, false_alarms: 0 });
    expect(out.find((t) => t.entryId === "a")).toMatchObject({ caughtBy: ["b"], falseAlarmsBy: [] });
    expect(out.find((t) => t.entryId === "b")).toMatchObject({ caughtBy: [], falseAlarmsBy: ["a"] });
    // Uno de tres cae: el último.
    expect(scores.filter((s) => s.eliminated).map((s) => s.entry_id)).toEqual(["a"]);
    expect(scores.map((s) => s.entry_id)).toEqual(["b", "c", "a"]);
  });

  it("una correcta refutada hace mala la trampa: su autor cae y quien la refutó caza", () => {
    const status = (seq: number): ClaimStatus | null => (seq === 2 ? "refuted" : "open");
    const { scores, traps: out } = scoreRound(entries, traps, [{ party: "p-c", targetSeq: 2, targetStep: 1, createdAt: at(5) }], status);
    expect(byId(scores, "a")).toMatchObject({ score: ARENA_POINTS.bad_trap, bad_trap: true, eliminated: true, reason: "bad_trap" });
    expect(byId(scores, "c")).toMatchObject({ catches: 1, false_alarms: 0 });
    expect(out.find((t) => t.entryId === "a")).toMatchObject({ bad: true, caughtBy: ["c"] });
    // La eliminación forzada ya cubre el tercio: nadie más cae.
    expect(scores.filter((s) => s.eliminated)).toHaveLength(1);
  });

  it("quien no pone trampa cae", () => {
    const { scores } = scoreRound(entries, traps.slice(0, 2), [], none);
    expect(byId(scores, "c")).toMatchObject({ eliminated: true, reason: "no_trap" });
    expect(scores.filter((s) => s.eliminated)).toHaveLength(1);
  });
});

describe("eliminate", () => {
  const s = (id: string, score: number, extra: Partial<ArenaScore> = {}): ArenaScore => ({
    entry_id: id,
    agent_name: id,
    model_family: "f",
    score,
    catches: 0,
    false_alarms: 0,
    survived: 0,
    bad_trap: false,
    first_catch_at: null,
    eliminated: false,
    reason: null,
    ...extra,
  });
  const es = ["a", "b", "c", "d", "e", "f"].map((id, i) => entry(id, i));

  it("elimina el tercio inferior, al menos uno", () => {
    const out = eliminate(["a", "b", "c", "d", "e", "f"].map((id, i) => s(id, 10 - i)), es);
    expect(out.filter((x) => x.eliminated).map((x) => x.entry_id)).toEqual(["e", "f"]);
    expect(eliminate([s("a", 1), s("b", 0)], es).filter((x) => x.eliminated).map((x) => x.entry_id)).toEqual(["b"]);
  });

  it("nunca deja fuera al único que queda", () => {
    expect(eliminate([s("a", 0)], es).every((x) => !x.eliminated)).toBe(true);
    const out = eliminate([s("a", 0), s("b", 5, { reason: "no_trap" }), s("c", 0, { reason: "bad_trap" })], es);
    expect(out.filter((x) => !x.eliminated).map((x) => x.entry_id)).toEqual(["a"]);
  });

  it("desempata por falsas alarmas, caza temprana e inscripción", () => {
    const out = eliminate(
      [
        s("a", 2, { false_alarms: 1 }),
        s("b", 2, { first_catch_at: at(20).toISOString() }),
        s("c", 2, { first_catch_at: at(10).toISOString() }),
      ],
      es,
    );
    expect(out.map((x) => x.entry_id)).toEqual(["c", "b", "a"]);
    expect(out.find((x) => x.entry_id === "a")?.eliminated).toBe(true);
  });
});

describe("clasificación y campeón", () => {
  const p = (id: string, status: "alive" | "eliminated", round: number | null, total: number, house = false) => ({
    id,
    house,
    status,
    eliminatedRound: round,
    totalScore: total,
    joinedAt: T0,
  });

  it("primero los vivos, luego quien cayó más tarde; la casa no es campeona", () => {
    const entries = [p("a", "eliminated", 1, 9), p("b", "eliminated", 2, 1), p("h", "alive", null, 0, true)];
    expect(placement(entries).map((e) => e.id)).toEqual(["h", "b", "a"]);
    expect(championOf(entries)?.id).toBe("b");
    expect(championOf([p("h", "alive", null, 0, true)])).toBeNull();
  });

  it("termina con uno o ninguno vivo", () => {
    expect(tournamentOver(0)).toBe(true);
    expect(tournamentOver(1)).toBe(true);
    expect(tournamentOver(2)).toBe(false);
  });
});

describe("trampas", () => {
  const post = (seq: number, extra: Record<string, unknown> = {}) => ({
    seq,
    type: "hypothesis",
    agentId: "me",
    problemId: "r1",
    steps: ["s1", "s2"],
    claimKind: "derivation",
    ...extra,
  });
  const ctx = { agentId: "me", problemId: "r1", usedSeqs: new Set<number>() };

  it("acepta una pareja válida", () => {
    expect(trapIssues({ seqs: [1, 2], broken_seq: 2, broken_step: 1 }, [post(1), post(2)], ctx)).toEqual([]);
  });

  it("rechaza parejas mal formadas", () => {
    const issues = (input: Parameters<typeof trapIssues>[0], posts = [post(1), post(2)], c = ctx) => trapIssues(input, posts, c);
    expect(issues({ seqs: [1, 1], broken_seq: 1, broken_step: 1 })).not.toEqual([]);
    expect(issues({ seqs: [1, 2], broken_seq: 3, broken_step: 1 })).not.toEqual([]);
    expect(issues({ seqs: [1, 2], broken_seq: 1 })).not.toEqual([]); // falta el paso
    expect(issues({ seqs: [1, 2], broken_seq: 1, broken_step: 3 })).not.toEqual([]);
    expect(issues({ seqs: [1, 2], broken_seq: 1, broken_step: 1 }, [post(1), post(2, { agentId: "other" })])).not.toEqual([]);
    expect(issues({ seqs: [1, 2], broken_seq: 1, broken_step: 1 }, [post(1), post(2, { problemId: "r0" })])).not.toEqual([]);
    expect(issues({ seqs: [1, 2], broken_seq: 1, broken_step: 1 }, [post(1), post(2, { type: "evidence" })])).not.toEqual([]);
    expect(issues({ seqs: [1, 2], broken_seq: 1, broken_step: 1 }, [post(1), post(2, { claimKind: "computation", steps: [] })])).not.toEqual([]);
    expect(issues({ seqs: [1, 2], broken_seq: 1, broken_step: 1 }, undefined, { ...ctx, usedSeqs: new Set([2]) })).not.toEqual([]);
    expect(issues({ seqs: [1, 2], broken_seq: 1, broken_step: 1 }, [post(1, { claimKind: "computation", steps: [] }), post(2, { claimKind: "computation", steps: [] })])).not.toEqual([]);
  });

  it("el compromiso depende de la sal y de cada campo", () => {
    const secret = { seqs: [1, 2] as [number, number], broken_seq: 1, broken_step: 2, witness: "n = 3" };
    const h = trapCommitment(secret, "aa");
    expect(trapCommitment(secret, "aa")).toBe(h);
    expect(trapCommitment(secret, "bb")).not.toBe(h);
    expect(trapCommitment({ ...secret, broken_seq: 2 }, "aa")).not.toBe(h);
    expect(trapCommitment({ ...secret, witness: "n = 5" }, "aa")).not.toBe(h);
  });
});
