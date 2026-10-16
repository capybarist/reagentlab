import { createHash, createHmac } from "node:crypto";
import type { BlobStore } from "@reagentlab/core";

/**
 * Almacenamiento de artefactos en R2 o cualquier S3 (ADR-0034), con URLs firmadas SigV4 hechas
 * a mano para no cargar el SDK. Las claves son `artifacts/<sha256>`. La subida firma la cabecera
 * `x-amz-checksum-sha256`: el almacenamiento rechaza un cuerpo que no tenga ese sha256.
 */
export interface S3Options {
  /** p. ej. https://<cuenta>.r2.cloudflarestorage.com */
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Para pruebas. */
  now?: () => Date;
}

export function s3BlobStore(opts: S3Options): BlobStore {
  const key = (sha256: string) => `artifacts/${sha256}`;
  const presign = (method: string, sha256: string, expiresSec: number, headers: Record<string, string> = {}) =>
    presignUrl({ ...opts, method, key: key(sha256), expiresSec, headers, now: (opts.now ?? (() => new Date()))() });
  return {
    kind: "s3",
    async presignPut(sha256, _bytes, expiresSec) {
      const headers = { "x-amz-checksum-sha256": Buffer.from(sha256, "hex").toString("base64") };
      return { url: presign("PUT", sha256, expiresSec, headers), headers };
    },
    async presignGet(sha256, expiresSec) {
      return presign("GET", sha256, expiresSec);
    },
    async head(sha256) {
      const res = await fetch(presign("HEAD", sha256, 60), { method: "HEAD" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HEAD de ${sha256} en el almacenamiento: ${res.status}`);
      return { bytes: Number(res.headers.get("content-length") ?? -1) };
    },
    async get(sha256) {
      const res = await fetch(presign("GET", sha256, 60));
      if (!res.ok) throw new Error(`GET de ${sha256} en el almacenamiento: ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}

/** RFC 3986, como lo pide SigV4. */
function enc(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

const hmac = (k: Buffer | string, s: string) => createHmac("sha256", k).update(s, "utf8").digest();
const sha256hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** URL firmada SigV4 por query string, con estilo de ruta (`/<bucket>/<clave>`). */
export function presignUrl(p: {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  method: string;
  key: string;
  expiresSec: number;
  headers: Record<string, string>;
  now: Date;
}): string {
  const url = new URL(p.endpoint);
  const host = url.host;
  const amzDate = p.now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const date = amzDate.slice(0, 8);
  const scope = `${date}/${p.region}/s3/aws4_request`;
  const basePath = url.pathname.replace(/\/$/, "");
  const path = `${basePath}/${[p.bucket, ...p.key.split("/")].map(enc).join("/")}`;

  const headers: Record<string, string> = { host };
  for (const [k, v] of Object.entries(p.headers)) headers[k.toLowerCase()] = v.trim();
  const headerNames = Object.keys(headers).sort();
  const signedHeaders = headerNames.join(";");

  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${p.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(p.expiresSec),
    "X-Amz-SignedHeaders": signedHeaders,
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${enc(k)}=${enc(query[k]!)}`)
    .join("&");
  const canonicalHeaders = headerNames.map((h) => `${h}:${headers[h]}\n`).join("");
  const canonicalRequest = [p.method, path, canonicalQuery, canonicalHeaders, signedHeaders, "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${p.secretAccessKey}`, date);
  const kSigning = hmac(hmac(hmac(kDate, p.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
  return `${url.protocol}//${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
