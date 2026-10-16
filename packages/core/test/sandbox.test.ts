import { describe, expect, it } from "vitest";
import { artifactFilename, hostJob, hostOutcome, hostSkipReason, normalizeOutput, outputsMatch } from "../src/sandbox.js";

const run = (exitCode: number | null, stdout: string, timedOut = false) => ({ exitCode, stdout, stderr: "", timedOut, durationMs: 1200 });

describe("sandbox del host (ADR-0033)", () => {
  it("solo ejecuta lenguajes conocidos y sin datos externos", () => {
    expect(hostSkipReason({ language: "Python", data_refs: [] })).toBeNull();
    expect(hostSkipReason({ language: "node", data_refs: [] })).toBeNull();
    expect(hostSkipReason({ language: "sage", data_refs: [] })).toMatch(/not supported/);
    expect(hostSkipReason({ language: "python", data_refs: ["https://oeis.org/A1"] })).toMatch(/network/);
  });

  it("el archivo sale del comando, sin carpetas, o el de por defecto", () => {
    expect(artifactFilename("python main.py", "python")).toBe("main.py");
    expect(artifactFilename("python3 -u search_bound.py --n 40", "python")).toBe("search_bound.py");
    expect(artifactFilename("python ../../etc/x.py", "python")).toBe("x.py");
    expect(artifactFilename("python -c 'print(1)'", "python")).toBe("main.py");
    expect(artifactFilename("node check.mjs", "javascript")).toBe("check.mjs");
    expect(hostJob({ language: "js", command: "node a.js", code: "1" })).toMatchObject({ image: "node:22-slim", filename: "a.js" });
    expect(hostJob({ language: "lean", command: "lake build", code: "1" })).toBeNull();
  });

  it("compara salidas sin fijarse en espacios finales ni saltos de línea", () => {
    expect(normalizeOutput("a  \r\nb\n\n")).toBe("a\nb");
    expect(outputsMatch("45\n", "45")).toBe(true);
    expect(outputsMatch("45", "46")).toBe(false);
    expect(outputsMatch(" 45", "45")).toBe(false);
  });

  it("solo confirma o falla un programa que terminó bien", () => {
    expect(hostOutcome(run(0, "45\n"), "45").outcome).toBe("confirms");
    expect(hostOutcome(run(0, "46\n"), "45").outcome).toBe("fails");
    expect(hostOutcome(run(1, "45\n"), "45").outcome).toBe("inconclusive");
    expect(hostOutcome(run(null, "", true), "45")).toMatchObject({ outcome: "inconclusive", reason: expect.stringMatching(/timed out/) });
  });
});
