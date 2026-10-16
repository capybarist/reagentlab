import { afterEach, describe, expect, it } from "vitest";
import { LabService, generateSigningSeed, signingKeyFromSeed, type Sandbox, type SandboxJob } from "@reagentlab/core";
import { createStore } from "../src/index.js";
import { evidence, hypothesis, setup } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => ctx?.database.close());

const LAB = "combinatorics";

const artifact = (extra: Record<string, unknown> = {}) => ({
  language: "python",
  environment: "python:3.12, no extra packages",
  command: "python main.py",
  code: "print(sum(range(10)))\n",
  expected_output: "45\n",
  data_refs: [],
  ...extra,
});

const computation = (extra: Record<string, unknown> = {}) =>
  hypothesis({
    claim_kind: "computation",
    evidence: [{ kind: "computation", description: "Summed 0..9 with the attached script; the result is 45." }],
    artifact: artifact(extra),
  });

/** Sandbox de mentira: devuelve lo que se le diga y apunta qué ejecutó. */
function fakeSandbox(stdout: string, exitCode: number | null = 0): Sandbox & { jobs: SandboxJob[] } {
  const jobs: SandboxJob[] = [];
  return {
    backend: "fake",
    jobs,
    async run(job) {
      jobs.push(job);
      return { exitCode, stdout, stderr: "", timedOut: false, durationMs: 10 };
    },
  };
}

async function scenario(post = computation()) {
  ctx = await setup();
  const service = new LabService(createStore(ctx.db), ctx.clock, signingKeyFromSeed(generateSigningSeed()));
  const [alice, bob, carol] = await Promise.all([ctx.agent("alice"), ctx.agent("bob", "gpt"), ctx.agent("carol", "gemini")]);
  await service.joinLab(alice, LAB);
  await service.joinLab(bob, LAB);
  await service.post(alice, LAB, post);
  await service.post(bob, LAB, evidence([1]));
  return { service, alice, bob, carol };
}

describe("reproducciones del host (ADR-0033)", () => {
  it("el host ejecuta el artefacto una vez y cuenta como una parte más", async () => {
    const { service, carol } = await scenario();
    const sandbox = fakeSandbox("45\n");
    expect(await service.runHostReproductions(sandbox)).toBe(1);
    expect(await service.runHostReproductions(sandbox)).toBe(0);
    expect(sandbox.jobs).toHaveLength(1);
    expect(sandbox.jobs[0]).toMatchObject({ image: "python:3.12-slim", filename: "main.py", command: "python main.py" });

    const [run] = await service.listHostRuns(LAB, 1);
    expect(run).toMatchObject({ outcome: "confirms", backend: "fake", untrusted_stdout: "45\n", claim_seq: 1 });
    expect(run?.server_sig).toBeTruthy();

    // Una confirmación de un agente más el host bastan para las 2 que pide la sala.
    await service.joinLab(carol, LAB);
    await service.submitVerification(carol, LAB, {
      claim_seq: 1,
      outcome: "confirms",
      log: "docker run --rm --network none python:3.12 python main.py → printed 45, same as expected_output.",
      environment: "python:3.12 in docker, --network none",
    });
    const [claim] = await service.listClaims(LAB);
    expect(claim?.verification).toMatchObject({ confirms: 2, fails: 0, host: "confirms" });
    expect((await service.listPublicEvents(LAB)).some((e) => e.kind === "host_run.recorded")).toBe(true);
  });

  it("si la salida no coincide, el claim apoyado vuelve a open", async () => {
    const { service } = await scenario();
    expect((await service.listClaims(LAB))[0]?.status).toBe("supported");
    await service.runHostReproductions(fakeSandbox("46\n"));
    const [claim] = await service.listClaims(LAB);
    expect(claim).toMatchObject({ status: "open", verification: { fails: 1, host: "fails" } });
  });

  it("un programa que no termina bien no confirma ni falla", async () => {
    const { service } = await scenario();
    await service.runHostReproductions(fakeSandbox("", 1));
    const [claim] = await service.listClaims(LAB);
    expect(claim).toMatchObject({ status: "supported", verification: { confirms: 0, fails: 0, inconclusive: 1 } });
  });

  it("no ejecuta lenguajes desconocidos ni artefactos con datos externos", async () => {
    const { service } = await scenario(computation({ language: "sage" }));
    const sandbox = fakeSandbox("45\n");
    expect(await service.runHostReproductions(sandbox)).toBe(0);
    expect(sandbox.jobs).toHaveLength(0);
  });
});
