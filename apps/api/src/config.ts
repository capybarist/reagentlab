export interface Config {
  databaseUrl: string;
  port: number;
  host: string;
  tokenPepper: string;
  /** Clave compartida con el servidor de la web (rutas `/v1/account`). */
  webServiceKey: string;
  /** Orígenes de la web que pueden leer la API pública desde el navegador. */
  corsOrigins: string[];
  /** Peticiones por minuto por token de agente o IP. */
  rateLimitPerMinute: number;
  /** Semilla ed25519 (base64, 32 bytes) con la que el servidor firma los posts. Vacía = clave local de desarrollo. */
  signingKey: string;
  /**
   * Agentes que la API deja listos al arrancar fuera de producción, con su token fijo:
   * `handle/nombre/familia/token`, separados por comas. Así el token de la config MCP
   * vale siempre.
   */
  devAgents: { handle: string; name: string; modelFamily: string; token: string }[];
  /** Handles que aprueban problemas propuestos (ADR-0020), separados por comas. */
  adminHandles: string[];
  /** Sandbox del host (ADR-0033): `off` (por defecto) o `docker`. */
  sandbox: "off" | "docker";
  /** Runtime de docker para el sandbox, p. ej. `runsc` (gVisor). Vacío = el de docker. */
  sandboxRuntime: string;
  /**
   * Archivos de artefactos (ADR-0034): `off`, `fs` (carpeta local; por defecto fuera de
   * producción) o `s3` (R2 o cualquier S3, con las variables S3_*).
   */
  blobStore: "off" | "fs" | "s3";
  blobDir: string;
  /** URL pública de esta API, para las URLs firmadas del almacenamiento local. */
  publicApiUrl: string;
  s3: { endpoint: string; bucket: string; region: string; accessKeyId: string; secretAccessKey: string };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const tokenPepper = env.TOKEN_PEPPER ?? "";
  if (!tokenPepper && env.NODE_ENV === "production") throw new Error("TOKEN_PEPPER es obligatorio en producción.");
  const signingKey = env.SIGNING_KEY ?? "";
  if (!signingKey && env.NODE_ENV === "production") {
    throw new Error("SIGNING_KEY es obligatoria en producción (genera una con `pnpm admin gen-signing-key`).");
  }
  return {
    databaseUrl: env.DATABASE_URL ?? "pglite:./.data/pglite",
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? "0.0.0.0",
    tokenPepper: tokenPepper || "dev-pepper",
    webServiceKey: env.WEB_SERVICE_KEY ?? (env.NODE_ENV === "production" ? "" : "dev-web-service-key"),
    corsOrigins: (env.WEB_ORIGIN ?? "http://localhost:3001").split(",").map((o) => o.trim()).filter(Boolean),
    rateLimitPerMinute: Number(env.RATE_LIMIT_PER_MINUTE ?? 120),
    signingKey,
    devAgents: parseDevAgents(env.DEV_AGENTS ?? ""),
    adminHandles: (env.ADMIN_HANDLES ?? "").split(",").map((h) => h.trim()).filter(Boolean),
    sandbox: parseSandbox(env.SANDBOX ?? "off"),
    sandboxRuntime: env.SANDBOX_RUNTIME ?? "",
    blobStore: parseBlobStore(env.BLOB_STORE ?? (env.NODE_ENV === "production" ? "off" : "fs"), env),
    blobDir: env.BLOB_DIR ?? "./.data/blobs",
    publicApiUrl: env.PUBLIC_API_URL ?? `http://localhost:${env.PORT ?? 3000}`,
    s3: {
      endpoint: env.S3_ENDPOINT ?? "",
      bucket: env.S3_BUCKET ?? "",
      region: env.S3_REGION ?? "auto",
      accessKeyId: env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? "",
    },
  };
}

function parseBlobStore(raw: string, env: NodeJS.ProcessEnv): Config["blobStore"] {
  if (raw !== "off" && raw !== "fs" && raw !== "s3") throw new Error(`BLOB_STORE debe ser "off", "fs" o "s3", no "${raw}".`);
  if (raw === "s3") {
    const missing = ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"].filter((k) => !env[k]);
    if (missing.length) throw new Error(`BLOB_STORE=s3 necesita ${missing.join(", ")}.`);
  }
  return raw;
}

function parseSandbox(raw: string): Config["sandbox"] {
  if (raw === "off" || raw === "docker") return raw;
  throw new Error(`SANDBOX debe ser "off" o "docker", no "${raw}".`);
}

export function parseDevAgents(raw: string): Config["devAgents"] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [handle, name, modelFamily, token] = entry.split("/").map((p) => p.trim());
      if (!handle || !name || !modelFamily || !token) {
        throw new Error(`DEV_AGENTS mal formado en "${entry}": usa handle/nombre/familia/token.`);
      }
      return { handle, name, modelFamily, token };
    });
}
