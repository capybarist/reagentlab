import type { ArtifactFile } from "@reagentlab/contracts";
import { DomainError } from "./errors.js";
import type { Repos } from "./ports.js";

/**
 * Almacenamiento de archivos de artefactos por su sha256 (ADR-0034): R2 o cualquier S3 en
 * producción, una carpeta local en desarrollo. Los agentes suben y bajan directamente con
 * URLs firmadas; la API solo las emite.
 */
export interface BlobStore {
  /** Nombre del backend, para los registros. */
  kind: string;
  /** URL y cabeceras para subir exactamente ese archivo (el almacenamiento comprueba el sha256). */
  presignPut(sha256: string, bytes: number, expiresSec: number): Promise<{ url: string; headers: Record<string, string> }>;
  presignGet(sha256: string, expiresSec: number): Promise<string>;
  /** Tamaño si está guardado, o null. */
  head(sha256: string): Promise<{ bytes: number } | null>;
  get(sha256: string): Promise<Uint8Array>;
}

export const UPLOAD_URL_TTL_SEC = 15 * 60;
export const DOWNLOAD_URL_TTL_SEC = 15 * 60;

/** Problemas de los archivos de un artefacto que no dependen del almacenamiento. */
export function artifactFilesIssue(files: readonly Pick<ArtifactFile, "name">[], codeFilename: string): string | null {
  const names = files.map((f) => f.name);
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) return `El archivo "${dup}" aparece dos veces en artifact.files.`;
  if (names.includes(codeFilename)) return `"${codeFilename}" es el archivo del código: usa otro nombre para los datos.`;
  return null;
}

/** Comprueba que cada archivo citado está subido con su tamaño; marca guardados los que acaban de llegar. */
export async function requireStoredBlobs(
  r: Repos,
  blobs: BlobStore | undefined,
  files: readonly ArtifactFile[],
  now: Date,
): Promise<void> {
  if (!files.length) return;
  if (!blobs) throw new DomainError("STORAGE_DISABLED", "Este servidor no guarda archivos de artefactos.");
  for (const f of files) {
    const row = await r.getBlob(f.sha256);
    if (row?.status === "stored" && row.bytes === f.bytes) continue;
    const head = row ? await blobs.head(f.sha256) : null;
    if (!row || !head || head.bytes !== f.bytes) {
      throw new DomainError(
        "BLOB_NOT_FOUND",
        `El archivo "${f.name}" (${f.sha256.slice(0, 12)}…) no está subido con ${f.bytes} bytes.`,
        "Pide permiso con request_upload, sube el archivo con la URL que te da y vuelve a publicar.",
      );
    }
    await r.markBlobStored(f.sha256, now);
  }
}
