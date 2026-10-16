import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sandbox, SandboxJob, SandboxResult } from "@reagentlab/core";

/** Lo que se lee de cada salida antes de cortar. */
const READ_MAX = 1_000_000;

/**
 * Sandbox del host con docker (ADR-0033): un contenedor desechable por artefacto, sin red,
 * sin privilegios, con el sistema de archivos de solo lectura y límites de memoria, CPU y
 * procesos. Con `runtime: "runsc"` corre bajo gVisor.
 */
export function dockerSandbox(opts: { runtime?: string; docker?: string } = {}): Sandbox {
  const docker = opts.docker ?? "docker";
  return {
    backend: opts.runtime ? `docker+${opts.runtime}` : "docker",
    async run(job: SandboxJob): Promise<SandboxResult> {
      const dir = await mkdtemp(join(tmpdir(), "rl-sandbox-"));
      const name = `rl-sbx-${randomUUID()}`;
      try {
        await writeFile(join(dir, job.filename), job.code, { mode: 0o644 });
        for (const f of job.files ?? []) await writeFile(join(dir, f.name), f.data, { mode: 0o644 });
        await chmod(dir, 0o755);
        const args = [
          "run",
          "--rm",
          "--name",
          name,
          "--pull",
          "missing",
          "--network",
          "none",
          "--memory",
          `${job.memoryMb}m`,
          "--memory-swap",
          `${job.memoryMb}m`,
          "--cpus",
          "1",
          "--pids-limit",
          "128",
          "--read-only",
          "--tmpfs",
          "/tmp:rw,size=64m",
          "--cap-drop",
          "ALL",
          "--security-opt",
          "no-new-privileges",
          "--user",
          "65534:65534",
          "-e",
          "HOME=/tmp",
          "-v",
          `${dir}:/work:ro`,
          "-w",
          "/work",
          ...(opts.runtime ? ["--runtime", opts.runtime] : []),
          job.image,
          "sh",
          "-c",
          job.command,
        ];
        const result = await exec(docker, args, job.timeoutMs, () => {
          spawn(docker, ["kill", name], { stdio: "ignore" }).on("error", () => {});
        });
        // 125 es un fallo de docker (imagen, daemon, opciones), no del artefacto: no se registra.
        if (result.exitCode === 125) throw new Error(`docker no pudo ejecutar el sandbox: ${result.stderr.slice(0, 500)}`);
        return result;
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}

function exec(cmd: string, args: string[], timeoutMs: number, onTimeout: () => void): Promise<SandboxResult> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (d: Buffer) => {
      if (stdout.length < READ_MAX) stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d: Buffer) => {
      if (stderr.length < READ_MAX) stderr += d.toString("utf8");
    });
    const timer = setTimeout(() => {
      timedOut = true;
      onTimeout();
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: timedOut ? null : code, stdout, stderr, timedOut, durationMs: performance.now() - started });
    });
  });
}
