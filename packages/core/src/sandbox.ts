import type { Artifact, VerificationOutcome } from "@reagentlab/contracts";
import { canonicalJson, sha256Hex } from "./hashing.js";

/**
 * Sandbox del host (ADR-0033), partes puras. La ejecución la hace un adaptador (docker en local,
 * el backend de producción en el despliegue); aquí se decide qué se ejecuta y qué significa.
 */

export interface SandboxJob {
  image: string;
  /** Nombre del archivo donde va el código, sin rutas. */
  filename: string;
  code: string;
  /** Comando del artefacto, tal cual: corre dentro del sandbox, nunca en el host. */
  command: string;
  timeoutMs: number;
  memoryMb: number;
}

export interface SandboxResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export interface Sandbox {
  /** Nombre del backend, para el registro (p. ej. "docker", "docker+runsc"). */
  backend: string;
  run(job: SandboxJob): Promise<SandboxResult>;
}

export const HOST_RUN_DOMAIN = "reagentlab/host-run/v1\n";
export const HOST_TIMEOUT_MS = 60_000;
export const HOST_MEMORY_MB = 512;
/** Lo que se guarda de cada salida. */
export const HOST_OUTPUT_MAX = 20_000;

const IMAGES: Record<string, { image: string; ext: string[]; fallback: string }> = {
  python: { image: "python:3.12-slim", ext: ["py"], fallback: "main.py" },
  javascript: { image: "node:22-slim", ext: ["js", "mjs", "cjs"], fallback: "main.js" },
};
const ALIASES: Record<string, string> = { python: "python", python3: "python", py: "python", javascript: "javascript", js: "javascript", node: "javascript", nodejs: "javascript" };

export function hostLanguage(language: string): keyof typeof IMAGES | null {
  return (ALIASES[language.trim().toLowerCase()] as keyof typeof IMAGES | undefined) ?? null;
}

/** Por qué el host no ejecuta un artefacto, o null si lo puede ejecutar. */
export function hostSkipReason(artifact: Pick<Artifact, "language" | "data_refs">): string | null {
  if (!hostLanguage(artifact.language)) return `language "${artifact.language}" is not supported by the host sandbox`;
  if (artifact.data_refs.length) return "the artifact needs external data and the sandbox has no network";
  return null;
}

/** El archivo que nombra el comando (solo el nombre, sin carpetas), o el de por defecto del lenguaje. */
export function artifactFilename(command: string, language: string): string {
  const lang = hostLanguage(language);
  const spec = lang ? IMAGES[lang]! : IMAGES.python!;
  const re = new RegExp(`(?:^|[\\s"'/])([A-Za-z0-9_-]+\\.(?:${spec.ext.join("|")}))(?=$|[\\s"'])`);
  return command.match(re)?.[1] ?? spec.fallback;
}

export function hostJob(artifact: Pick<Artifact, "language" | "command" | "code">): SandboxJob | null {
  const lang = hostLanguage(artifact.language);
  if (!lang) return null;
  return {
    image: IMAGES[lang]!.image,
    filename: artifactFilename(artifact.command, artifact.language),
    code: artifact.code,
    command: artifact.command,
    timeoutMs: HOST_TIMEOUT_MS,
    memoryMb: HOST_MEMORY_MB,
  };
}

/** Normaliza una salida: saltos de línea Unix, sin espacios al final de línea ni líneas vacías al final. */
export function normalizeOutput(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .replace(/\n+$/, "");
}

export function outputsMatch(expected: string, actual: string): boolean {
  return normalizeOutput(expected) === normalizeOutput(actual);
}

/**
 * Qué dice el host de una ejecución. Solo confirma o falla un programa que terminó bien: si no
 * terminó (error, falta una dependencia, tiempo agotado) el host no sabe si el cálculo es correcto.
 */
export function hostOutcome(result: SandboxResult, expected: string): { outcome: VerificationOutcome; reason: string } {
  if (result.timedOut) return { outcome: "inconclusive", reason: `timed out after ${Math.round(result.durationMs / 1000)} s` };
  if (result.exitCode !== 0) return { outcome: "inconclusive", reason: `exited with code ${result.exitCode ?? "none"}` };
  return outputsMatch(expected, result.stdout)
    ? { outcome: "confirms", reason: "output matches expected_output" }
    : { outcome: "fails", reason: "the program ran and its output differs from expected_output" };
}

export function clip(s: string, max = HOST_OUTPUT_MAX): string {
  return s.length > max ? `${s.slice(0, max)}\n[… ${s.length - max} more characters]` : s;
}

/** Lo que firma el servidor de cada reproducción. */
export function hostRunSigningMessage(record: {
  lab: string;
  claim_seq: number;
  artifact_sha256: string;
  backend: string;
  image: string;
  outcome: VerificationOutcome;
  exit_code: number | null;
  timed_out: boolean;
  stdout_sha256: string;
  created_at: string;
}): string {
  return HOST_RUN_DOMAIN + sha256Hex(canonicalJson(record));
}
