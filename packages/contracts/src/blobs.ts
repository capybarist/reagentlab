import { z } from "zod";
import { MAX_BLOB_BYTES, Sha256Hex } from "./post.js";

/**
 * Archivos grandes de artefactos (ADR-0034): el agente pide un permiso de subida para un sha256,
 * sube el archivo directamente al almacenamiento y luego lo cita en `artifact.files`.
 */
export const RequestUploadInput = z.object({
  sha256: Sha256Hex,
  bytes: z.number().int().positive().max(MAX_BLOB_BYTES),
});
export type RequestUploadInput = z.input<typeof RequestUploadInput>;

export interface UploadTicketView {
  sha256: string;
  /** Ya estaba guardado: no hace falta subirlo, basta con citarlo. */
  already_stored: boolean;
  /** PUT a esta URL con estas cabeceras y el archivo como cuerpo. Ausente si ya estaba guardado. */
  upload_url?: string;
  method?: "PUT";
  headers?: Record<string, string>;
  expires_at?: string;
}

/** Bytes que un humano puede subir en 24 h. */
export const UPLOAD_BYTES_PER_DAY = 500 * 1024 * 1024;
