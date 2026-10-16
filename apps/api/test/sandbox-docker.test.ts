import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { hostJob } from "@reagentlab/core";
import { dockerSandbox } from "../src/sandbox-docker.js";

/** Solo corre donde hay docker con daemon (no en CI): `SANDBOX_TEST=1 pnpm test`. */
const hasDocker = (() => {
  if (process.env.SANDBOX_TEST !== "1") return false;
  try {
    execFileSync("docker", ["info"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasDocker)("sandbox docker (ADR-0033)", () => {
  const sandbox = dockerSandbox();
  const job = (code: string, command = "python main.py") =>
    ({ ...hostJob({ language: "python", command, code })!, timeoutMs: 20_000 });

  it("ejecuta el artefacto y devuelve su salida", async () => {
    const r = await sandbox.run(job("print(sum(range(10)))\n"));
    expect(r).toMatchObject({ exitCode: 0, stdout: "45\n", timedOut: false });
  });

  it("sin red, sin escribir en /work y sin root", async () => {
    const r = await sandbox.run(
      job(
        [
          "import os, socket",
          "print(os.getuid())",
          "try:\n    socket.create_connection(('1.1.1.1', 80), timeout=3); print('net')\nexcept OSError: print('no-net')",
          "try:\n    open('/work/x', 'w'); print('rw')\nexcept OSError: print('ro')",
        ].join("\n"),
      ),
    );
    expect(r.stdout.split("\n").slice(0, 3)).toEqual(["65534", "no-net", "ro"]);
  });

  it("corta lo que pasa del tiempo", async () => {
    const r = await sandbox.run({ ...job("import time\ntime.sleep(30)\n"), timeoutMs: 2_000 });
    expect(r.timedOut).toBe(true);
    expect(r.exitCode).toBeNull();
  }, 30_000);
});
